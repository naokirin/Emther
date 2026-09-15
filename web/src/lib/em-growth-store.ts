import { randomUUID } from "node:crypto";
import { loadJSON, saveJSON } from "@/lib/persistence";
import { unmaskNames } from "@/lib/people-directory";
import { findReferenceUrls } from "@/lib/reference-lookup";

// docs/2nd_pivot_version.md Phase 8。pivot_policy.mdの5番目のAI役割「Grow」（EM自身の
// 学びの提示）専用の永続化。組織向けのSuggestion（採用/却下でEmtherの前提が変わる、
// 未来のプロンプトへ再注入される「組織の記憶」）とは性質が異なり、Growの提案は
// 組織の状態や前提を変更しない「EMへの参考情報」そのものなので、朝サマリーのproposal
// と同じく生成された時点で確定として扱う（AIの下書き→EM採用、という中間段階を挟まない）。
// EM側の反応（確認済み/見送り）は評価ではなく、軽量な既読管理のためだけに持たせる
// （Issueの手入れ用ステータスのような管理負担を再発生させないよう、状態はこの3値のみ）。

export type GrowReference = {
  // 参考になりそうな学びのトピック・理論名・フレームワーク名・著者名等。
  topic: string;
  // true: 理論の提唱者による原著・原典（一次資料）。英語であっても構わない。
  // false: 実務書・解説記事等の二次資料。日本語のものを優先する。
  isPrimarySource: boolean;
  note?: string;
  // ユーザー要望「参考文献やWeb記事、書籍のリンクを乗せてほしい」対応。LLMが実在すると
  // 確信できるURL（Wikipedia・公式サイト・出版社ページ等）のみを想定した任意項目。
  // 不確かな場合はLLM側でurlを省略する運用とし、UI側はurl不在時にtopicの検索リンクへ
  // フォールバックする（存在しない/誤ったURLを断定的に提示しないための二段構え）。
  url?: string;
};

export type GrowSuggestionDraft = {
  title: string;
  rationale: string;
  evidenceSummary?: string;
  references: GrowReference[];
};

export type GrowSuggestionStatus = "unread" | "acknowledged" | "dismissed";

export const GROW_SUGGESTION_STATUSES: GrowSuggestionStatus[] = ["unread", "acknowledged", "dismissed"];

export type GrowSuggestion = GrowSuggestionDraft & {
  id: string;
  weekKey: string;
  status: GrowSuggestionStatus;
  sourceRunId?: string;
  generatedAt: number;
};

const growSuggestions: GrowSuggestion[] = loadJSON<GrowSuggestion[]>("em-growth-suggestions.json", []);

function persist(): void {
  saveJSON("em-growth-suggestions.json", growSuggestions);
}

// scheduled-tasks.tsのisoWeekKeyと同じロジック（週次バッチの二重起動ガードと共通化
// する必要が無く、循環import回避のためこのモジュール内に複製している）。
function isoWeekKey(now: Date): string {
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

export function listGrowSuggestions(): GrowSuggestion[] {
  return [...growSuggestions].sort((a, b) => b.generatedAt - a.generatedAt);
}

export function getGrowSuggestion(id: string): GrowSuggestion | undefined {
  return growSuggestions.find((s) => s.id === id);
}

/**
 * Growバッチ1回の生成結果をまとめて保存する。呼び出し元（agent-runtime）が渡す
 * draftのテキストは、クラウドLLMの応答から抽出したものであり、既にPERSON_n ID化
 * された状態（実名を含まない）である前提のため、ここでは追加のmaskForStorageは
 * 行わない（applyAssistantResultTextがrun.suggestedThemes等をそのまま保存するのと
 * 同じ扱い）。
 */
export function createGrowSuggestions(
  drafts: GrowSuggestionDraft[],
  opts: { sourceRunId?: string; now?: number } = {},
): GrowSuggestion[] {
  const now = opts.now ?? Date.now();
  const weekKey = isoWeekKey(new Date(now));
  const created: GrowSuggestion[] = drafts.map((draft) => ({
    ...draft,
    id: randomUUID(),
    weekKey,
    status: "unread",
    sourceRunId: opts.sourceRunId,
    generatedAt: now,
  }));
  growSuggestions.push(...created);
  persist();
  return created;
}

/**
 * ユーザー要望「検索ばかりなので、もう少し直接知れるリンク先を探すようにしてほしい」対応。
 * LLMがurlを付けなかった（実在に確信が持てなかった）参照について、隔離されたWebSearch専用
 * サブエージェント（reference-lookup.ts、組織のコンテキストは一切渡さずtopic文字列のみを渡す）
 * へ問い合わせ、見つかれば実際のURLを後追いで補完する。生成直後のcreateGrowSuggestionsから
 * fire-and-forgetで呼ばれる想定（呼び出し元はレスポンスを待たない）。ネットワーク遅延・失敗
 * があっても呼び出し元の処理（run完了・ログ）はブロックしない。
 * 1提案あたりのurl未設定の参照はまとめて1回のCLI呼び出しに載せ、呼び出し回数・コストを抑える。
 */
export async function enrichGrowSuggestionReferences(suggestions: GrowSuggestion[]): Promise<void> {
  let anyChanged = false;
  for (const target of suggestions) {
    const current = growSuggestions.find((s) => s.id === target.id);
    if (!current || current.references.length === 0) continue;

    const pending = current.references.filter((r) => !r.url);
    if (pending.length === 0) continue;

    const results = await findReferenceUrls(
      pending.map((r) => ({ topic: r.topic, isPrimarySource: r.isPrimarySource, note: r.note })),
    );
    const urlByTopic = new Map(results.filter((r) => r.url).map((r) => [r.topic, r.url as string]));
    if (urlByTopic.size === 0) continue;

    current.references = current.references.map((r) => {
      const foundUrl = r.url ?? urlByTopic.get(r.topic);
      return foundUrl ? { ...r, url: foundUrl } : r;
    });
    anyChanged = true;
  }
  if (anyChanged) persist();
}

export function setGrowSuggestionStatus(id: string, status: GrowSuggestionStatus): GrowSuggestion | undefined {
  const s = growSuggestions.find((x) => x.id === id);
  if (!s) return undefined;
  s.status = status;
  persist();
  return s;
}

export function toGrowSuggestionView(s: GrowSuggestion): GrowSuggestion {
  return {
    ...s,
    title: unmaskNames(s.title),
    rationale: unmaskNames(s.rationale),
    evidenceSummary: s.evidenceSummary ? unmaskNames(s.evidenceSummary) : undefined,
    references: s.references.map((r) => ({
      ...r,
      topic: unmaskNames(r.topic),
      note: r.note ? unmaskNames(r.note) : undefined,
    })),
  };
}
