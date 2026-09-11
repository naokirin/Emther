import { extractFirstJsonObject } from "@/lib/local-model";
import { runCloudChat } from "@/lib/cloud-chat";
import type { ObjectiveImportDraft } from "@/lib/org-context-store";
import { ensureNameCandidatesAllowed, maskForStorage, unmaskNames } from "@/lib/people-directory";
import { isUnconfirmedNameCandidatesError, type MaskOptions } from "@/lib/name-candidate-confirmation";

// docs/usage_issues U18: 既存のOKR全文を Objective / Key Result / メモに分解する。
// 複雑なOKRはローカル小モデルでは壊れるため、SettingsのCLI優先順で外部AIに任せる。
// 失敗時・明らかに構造化マークダウンなのにクラウド結果が薄いときはヒューリスティックへ落とす。

const SYSTEM_PROMPT = [
  "あなたはOKRテキストを構造化し、JSONだけを出力するツールです。説明や前置き・Markdownフェンスは一切書かず、JSONオブジェクト1つだけを出力してください。",
  'フォーマット: {"objectives":[{"title":string,"note":string,"keyResults":string[]}]}',
  "titleはObjective（目標）本文。Markdownの見出し記号や「Objective 1：」などのラベルは除く。",
  "keyResultsは各Key Resultの本文配列。ネストされた箇条書き・番号付き補足は、親Key Resultの文字列に改行で含めてよい。",
  "noteはObjective全体の判断理由・補足があれば入れ、無ければ空文字。Key Result配下の補足はnoteにまとめずkeyResults側へ。",
  "テキストに無い情報を推測で作らないこと。Objectiveが複数あるときはすべて列挙すること。",
].join("\n");

const FEW_SHOT_EXAMPLES: Array<{ user: string; assistant: string }> = [
  {
    user: [
      "# Objective 1：【Build】基盤を進化させる",
      "",
      "- Key Result 1：リリースが完了している",
      "    1. アンケート",
      "    2. 通知",
      "- Key Result 2：認証がプライマリになっている",
      "    - ムーンショットとして設定",
      "",
      "# Objective 2：【Guide】判断を仕組み化する",
      "",
      "- Key Result 1：需要を整理できる",
    ].join("\n"),
    assistant: JSON.stringify({
      objectives: [
        {
          title: "【Build】基盤を進化させる",
          note: "",
          keyResults: [
            "リリースが完了している\n1. アンケート\n2. 通知",
            "認証がプライマリになっている\n- ムーンショットとして設定",
          ],
        },
        {
          title: "【Guide】判断を仕組み化する",
          note: "",
          keyResults: ["需要を整理できる"],
        },
      ],
    }),
  },
  {
    user: [
      "Objective: プロダクトの信頼性を上げる",
      "メモ: インシデントが四半期で増えたため",
      "- 重大インシデントを半期で50%削減する",
      "- デプロイ失敗率を1%未満にする",
    ].join("\n"),
    assistant: JSON.stringify({
      objectives: [
        {
          title: "プロダクトの信頼性を上げる",
          note: "インシデントが四半期で増えたため",
          keyResults: ["重大インシデントを半期で50%削減する", "デプロイ失敗率を1%未満にする"],
        },
      ],
    }),
  },
];

/** 「# Objective 1：…」「Objective: …」「O1: …」「目標：…」 */
const OBJECTIVE_LINE =
  /^(?:#{1,6}\s*)?(?:objective|o(?:bj)?|目標)\s*\d*\s*[:：.\-–—)]\s*(.+)$/i;
/** 「- Key Result 1：…」「KR1: …」「成果指標：…」（行頭の箇条書き記号は任意） */
const KR_LINE = /^(?:[-*・]\s+)*(?:key\s*result|kr|成果指標)\s*\d*\s*[:：.\-–—)]\s*(.+)$/i;
const NOTE_LINE = /^(?:[-*・]\s+)*(?:note|メモ|補足|理由)\s*[:：]\s*(.+)$/i;
const BULLET_OR_NUMBER = /^(?:[-*・]\s+|\d+[.)]\s+)(.+)$/;
const HORIZONTAL_RULE = /^-{3,}$/;

function normalizeDraft(raw: {
  title?: unknown;
  note?: unknown;
  keyResults?: unknown;
}): ObjectiveImportDraft | null {
  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  if (!title) return null;
  const note = typeof raw.note === "string" && raw.note.trim() ? raw.note.trim() : undefined;
  const keyResults = Array.isArray(raw.keyResults)
    ? raw.keyResults.filter((t): t is string => typeof t === "string").map((t) => t.trim()).filter(Boolean)
    : [];
  return { title, ...(note ? { note } : {}), keyResults };
}

function unmaskDraft(draft: ObjectiveImportDraft): ObjectiveImportDraft {
  return {
    title: unmaskNames(draft.title),
    ...(draft.note ? { note: unmaskNames(draft.note) } : {}),
    keyResults: draft.keyResults.map((t) => unmaskNames(t)),
  };
}

function countObjectiveMarkers(text: string): number {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => OBJECTIVE_LINE.test(l)).length;
}

function totalKeyResults(drafts: ObjectiveImportDraft[]): number {
  return drafts.reduce((n, d) => n + d.keyResults.length, 0);
}

/**
 * Markdown見出し付きOKRや O/KR 接頭辞を行スキャンで分解する。
 * - 「- Key Result N：…」→ Key Result
 * - インデント付きのネスト行 → 直前の Key Result に改行で付与
 * - インデント無しの普通の箇条書き → Key Result（短い書式向け）
 */
export function parseOkrTextHeuristic(text: string): ObjectiveImportDraft[] {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  const lines = normalized.split("\n");
  const drafts: ObjectiveImportDraft[] = [];
  let current: ObjectiveImportDraft | null = null;

  const pushCurrent = () => {
    if (!current) return;
    const draft = normalizeDraft(current);
    if (draft) drafts.push(draft);
    current = null;
  };

  const appendToLastKr = (detail: string) => {
    if (!current || current.keyResults.length === 0) return false;
    const last = current.keyResults.length - 1;
    current.keyResults[last] = `${current.keyResults[last]}\n${detail}`;
    return true;
  };

  for (const raw of lines) {
    const indent = raw.match(/^ */)?.[0].length ?? 0;
    const line = raw.trim();
    if (!line || HORIZONTAL_RULE.test(line)) continue;

    const objectiveMatch = line.match(OBJECTIVE_LINE);
    if (objectiveMatch) {
      pushCurrent();
      current = { title: objectiveMatch[1].trim(), keyResults: [] };
      continue;
    }

    const noteMatch = line.match(NOTE_LINE);
    if (noteMatch && current) {
      const n = noteMatch[1].trim();
      if (n) current.note = current.note ? `${current.note}\n${n}` : n;
      continue;
    }

    const krMatch = line.match(KR_LINE);
    if (krMatch) {
      if (!current) {
        current = { title: "(無題のObjective)", keyResults: [] };
      }
      current.keyResults.push(krMatch[1].trim());
      continue;
    }

    const nested = line.match(BULLET_OR_NUMBER);
    if (nested && current) {
      const detail = nested[1].trim();
      if (!detail) continue;
      // インデント付き、または既にKRがあり番号付き行 → 直前KRの補足
      if (indent >= 2 || (/^\d+[.)]\s+/.test(line) && current.keyResults.length > 0)) {
        if (appendToLastKr(detail)) continue;
      }
      // トップレベルの普通の箇条書きは Key Result 本体
      current.keyResults.push(detail);
      continue;
    }

    // ラベル無しのプレーン行
    if (!current) {
      current = { title: line, keyResults: [] };
    } else if (current.keyResults.length === 0) {
      current.title = `${current.title}\n${line}`;
    } else if (indent >= 2) {
      appendToLastKr(line);
    } else {
      appendToLastKr(line);
    }
  }

  pushCurrent();
  return drafts;
}

function parseModelObjectives(structured: unknown): ObjectiveImportDraft[] {
  if (!structured || typeof structured !== "object") return [];
  const list = (structured as { objectives?: unknown }).objectives;
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => (item && typeof item === "object" ? normalizeDraft(item as Record<string, unknown>) : null))
    .filter((d): d is ObjectiveImportDraft => !!d);
}

export type ParseOkrTextResult = {
  objectives: ObjectiveImportDraft[];
  source: "cloud" | "heuristic";
};

/** クラウド結果が入力の構造マーカーに対して明らかに薄い／欠けるとき true。 */
export function shouldPreferHeuristic(
  input: string,
  cloud: ObjectiveImportDraft[],
  heuristic: ObjectiveImportDraft[],
): boolean {
  if (heuristic.length === 0) return false;
  if (cloud.length === 0) return true;

  const markers = countObjectiveMarkers(input);
  const heuristicKrs = totalKeyResults(heuristic);
  const cloudKrs = totalKeyResults(cloud);

  // 入力に Objective 見出しが複数あるのにクラウドが1件以下、またはKR総数が大幅に少ない
  if (markers >= 2 && cloud.length < Math.min(markers, heuristic.length)) return true;
  if (heuristicKrs >= 3 && cloudKrs < Math.ceil(heuristicKrs / 2)) return true;
  if (heuristic.length > cloud.length && heuristicKrs > cloudKrs) return true;
  return false;
}

/** 外部AIで構造化し、失敗・薄い結果ならヒューリスティックへフォールバックする。 */
export async function parseOkrText(text: string, opts: MaskOptions = {}): Promise<ParseOkrTextResult> {
  const trimmed = text.trim();
  if (!trimmed) return { objectives: [], source: "heuristic" };

  const heuristic = parseOkrTextHeuristic(trimmed);

  let cloudDrafts: ObjectiveImportDraft[] = [];
  try {
    await ensureNameCandidatesAllowed([trimmed], opts);
    const masked = await maskForStorage(trimmed, opts);
    const fewShot = FEW_SHOT_EXAMPLES.flatMap((ex) => [
      `入力:\n${ex.user}`,
      `出力:\n${ex.assistant}`,
    ]).join("\n\n");
    const userPrompt = [
      "次のOKRテキストを指定フォーマットのJSONに変換してください。",
      "",
      "参考例:",
      fewShot,
      "",
      "変換対象:",
      masked,
    ].join("\n");

    const content = await runCloudChat(SYSTEM_PROMPT, userPrompt);
    const jsonText = extractFirstJsonObject(content);
    if (jsonText) {
      try {
        cloudDrafts = parseModelObjectives(JSON.parse(jsonText)).map(unmaskDraft);
      } catch {
        cloudDrafts = [];
      }
    }
  } catch (err) {
    if (isUnconfirmedNameCandidatesError(err)) throw err;
    cloudDrafts = [];
  }

  if (cloudDrafts.length > 0 && !shouldPreferHeuristic(trimmed, cloudDrafts, heuristic)) {
    return { objectives: cloudDrafts, source: "cloud" };
  }
  return { objectives: heuristic, source: "heuristic" };
}
