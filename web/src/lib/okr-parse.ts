import { extractFirstJsonObject, runLocalChat } from "@/lib/local-model";
import type { ObjectiveImportDraft } from "@/lib/org-context-store";

// docs/usage_issues U18: 既存のOKR全文を Objective / Key Result / メモに分解する。
// Journal と同じくローカルモデル＋JSON抽出を使い、失敗時はヒューリスティックに落とす
// （構造化は補助。プレビューで人間が直せる前提）。

const SYSTEM_PROMPT = [
  "あなたはOKRテキストを構造化し、JSONだけを出力するツールです。説明や前置きは一切書かず、JSONオブジェクト1つだけを出力してください。",
  'フォーマット: {"objectives":[{"title":string,"note":string,"keyResults":string[]}]}',
  "titleはObjective（目標）。keyResultsは測定可能なKey Resultの配列。noteは判断理由・補足があれば入れ、無ければ空文字。",
  "テキストに無い情報を推測で作らないこと。Objectiveが複数あるときはすべて列挙すること。",
].join("\n");

const FEW_SHOT_EXAMPLES: Array<{ user: string; assistant: string }> = [
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
  {
    user: [
      "O1: 顧客体験を改善する",
      "KR1: NPSを+10",
      "KR2: サポート初回解決率を80%へ",
      "",
      "O2: エンジニアリング速度を上げる",
      "KR1: リードタイムを2週間以内に",
    ].join("\n"),
    assistant: JSON.stringify({
      objectives: [
        {
          title: "顧客体験を改善する",
          note: "",
          keyResults: ["NPSを+10", "サポート初回解決率を80%へ"],
        },
        {
          title: "エンジニアリング速度を上げる",
          note: "",
          keyResults: ["リードタイムを2週間以内に"],
        },
      ],
    }),
  },
];

const OBJECTIVE_PREFIX = /^(?:objective|o(?:bj)?|目標)\s*\d*\s*[:：.#)]\s*/i;
const KR_PREFIX = /^(?:key\s*result|kr|成果指標)\s*\d*\s*[:：.#)]\s*/i;
const NOTE_PREFIX = /^(?:note|メモ|補足|理由)\s*[:：]\s*/i;
const BULLET_PREFIX = /^[-*・]\s+/;

function stripPrefix(line: string, re: RegExp): string {
  return line.replace(re, "").trim();
}

function isKrLine(line: string): boolean {
  return KR_PREFIX.test(line) || BULLET_PREFIX.test(line);
}

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

/** AI失敗時・テスト用。空行区切りのブロックと O/KR/メモ 接頭辞を解釈する。 */
export function parseOkrTextHeuristic(text: string): ObjectiveImportDraft[] {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  const blocks = normalized.split(/\n{2,}/);
  const drafts: ObjectiveImportDraft[] = [];

  for (const block of blocks) {
    const lines = block
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) continue;

    let title = "";
    let note: string | undefined;
    const keyResults: string[] = [];
    const titleParts: string[] = [];

    for (const line of lines) {
      if (NOTE_PREFIX.test(line)) {
        const n = stripPrefix(line, NOTE_PREFIX);
        if (n) note = note ? `${note}\n${n}` : n;
        continue;
      }
      if (isKrLine(line)) {
        const kr = stripPrefix(line, KR_PREFIX);
        const cleaned = stripPrefix(kr, BULLET_PREFIX);
        if (cleaned) keyResults.push(cleaned);
        continue;
      }
      if (OBJECTIVE_PREFIX.test(line)) {
        const t = stripPrefix(line, OBJECTIVE_PREFIX);
        if (t) {
          if (!title) title = t;
          else titleParts.push(t);
        }
        continue;
      }
      if (!title && keyResults.length === 0) {
        title = line;
      } else if (title && keyResults.length === 0 && !note) {
        // タイトル直後の非KR行は複数行タイトルとして結合
        title = `${title}\n${line}`;
      } else {
        titleParts.push(line);
      }
    }

    if (!title && titleParts.length > 0) {
      title = titleParts.shift()!;
    }
    // 余り行は KR 未検出時の追加タイトル断片として捨てず、メモへ寄せる
    if (titleParts.length > 0) {
      const extra = titleParts.join("\n");
      note = note ? `${note}\n${extra}` : extra;
    }

    const draft = normalizeDraft({ title, note, keyResults });
    if (draft) drafts.push(draft);
  }

  // ブロック分割できず1塊のとき、行頭の O/KR で再スキャン
  if (drafts.length <= 1 && drafts[0]?.keyResults.length === 0) {
    const lines = normalized
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const hasMarkers = lines.some((l) => OBJECTIVE_PREFIX.test(l) || KR_PREFIX.test(l));
    if (hasMarkers) {
      const rescanned: ObjectiveImportDraft[] = [];
      let current: ObjectiveImportDraft | null = null;
      for (const line of lines) {
        if (OBJECTIVE_PREFIX.test(line)) {
          if (current) rescanned.push(current);
          current = { title: stripPrefix(line, OBJECTIVE_PREFIX), keyResults: [] };
          continue;
        }
        if (!current) {
          current = { title: stripPrefix(line, OBJECTIVE_PREFIX) || line, keyResults: [] };
          continue;
        }
        if (NOTE_PREFIX.test(line)) {
          const n = stripPrefix(line, NOTE_PREFIX);
          if (n) current.note = current.note ? `${current.note}\n${n}` : n;
          continue;
        }
        if (isKrLine(line)) {
          const kr = stripPrefix(stripPrefix(line, KR_PREFIX), BULLET_PREFIX);
          if (kr) current.keyResults.push(kr);
          continue;
        }
        current.title = `${current.title}\n${line}`;
      }
      if (current) rescanned.push(current);
      const cleaned = rescanned.map((d) => normalizeDraft(d)).filter((d): d is ObjectiveImportDraft => !!d);
      if (cleaned.length > 0) return cleaned;
    }
  }

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
  source: "model" | "heuristic";
};

/** ローカルモデルで構造化し、失敗・空結果ならヒューリスティックへフォールバックする。 */
export async function parseOkrText(text: string): Promise<ParseOkrTextResult> {
  const trimmed = text.trim();
  if (!trimmed) return { objectives: [], source: "heuristic" };

  try {
    const content = await runLocalChat(
      [
        { role: "system", content: SYSTEM_PROMPT },
        ...FEW_SHOT_EXAMPLES.flatMap((ex) => [
          { role: "user" as const, content: ex.user },
          { role: "assistant" as const, content: ex.assistant },
        ]),
        { role: "user", content: trimmed },
      ],
      600,
    );
    const jsonText = extractFirstJsonObject(content);
    if (jsonText) {
      try {
        const parsed = parseModelObjectives(JSON.parse(jsonText));
        if (parsed.length > 0) return { objectives: parsed, source: "model" };
      } catch {
        // fall through
      }
    }
  } catch {
    // fall through
  }

  return { objectives: parseOkrTextHeuristic(trimmed), source: "heuristic" };
}
