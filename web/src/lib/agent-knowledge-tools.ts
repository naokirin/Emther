import { cosineSimilarity, embedText } from "@/lib/embeddings";
import { listJournalEntriesPage } from "@/lib/journal-store";
import { getIssue, listIssues, type Issue } from "@/lib/issue-store";
import { findByIdPrefix } from "@/lib/id-prefix";
import { maskNames } from "@/lib/people-directory";
import {
  RELATED_SIMILARITY_THRESHOLD,
  searchSimilarOpenIssues,
  type SimilarIssue,
} from "@/lib/related-context";
import { searchSimilarEvents } from "@/lib/knowledge-store";

// docs/usage_issues U19 / U14-C。
// CLI のネイティブツールは無効のまま、アプリ側の読み取り専用照会を
// ```lookup``` ブロック経由でエージェントに提供する。secure（実名対応表）は触らない。
// 返すテキストはマスク済み（PERSON_n）のまま——クラウドへ戻すため。

export const LOOKUP_MAX_QUERIES = 3;
export const LOOKUP_MAX_ROUNDS = 2;
export const LOOKUP_DEFAULT_LIMIT = 10;
export const LOOKUP_HARD_LIMIT = 20;

export type LookupQuery =
  | {
      type: "issues";
      query: string;
      includeDone?: boolean;
      includeArchived?: boolean;
      limit?: number;
    }
  | { type: "issue"; id: string }
  | { type: "journals"; query: string; limit?: number }
  | { type: "similar"; query: string; limit?: number };

export type LookupRequest = {
  /** ログ用。なぜ追加照会するか（任意）。 */
  reason?: string;
  queries: LookupQuery[];
};

function clampLimit(n: unknown): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return LOOKUP_DEFAULT_LIMIT;
  return Math.max(1, Math.min(LOOKUP_HARD_LIMIT, Math.floor(n)));
}

function normalizeQueryText(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const t = raw.trim();
  return t.length > 0 ? t : undefined;
}

function parseLookupQuery(raw: unknown): LookupQuery | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const obj = raw as Record<string, unknown>;
  const type = obj.type;
  if (type === "issue") {
    const id = normalizeQueryText(obj.id);
    return id ? { type: "issue", id } : undefined;
  }
  if (type === "issues") {
    const query = normalizeQueryText(obj.query);
    if (!query) return undefined;
    return {
      type: "issues",
      query,
      includeDone: obj.includeDone === true,
      includeArchived: obj.includeArchived === true,
      limit: clampLimit(obj.limit),
    };
  }
  if (type === "journals") {
    const query = normalizeQueryText(obj.query);
    if (!query) return undefined;
    return { type: "journals", query, limit: clampLimit(obj.limit) };
  }
  if (type === "similar") {
    const query = normalizeQueryText(obj.query);
    if (!query) return undefined;
    return { type: "similar", query, limit: clampLimit(obj.limit) };
  }
  return undefined;
}

/** ```lookup``` ブロックを抽出。不正・空は undefined。 */
export function extractLookup(resultText: string): LookupRequest | undefined {
  const match = resultText.match(/```lookup\s*\n?([\s\S]*?)```/);
  if (!match) return undefined;
  try {
    const parsed = JSON.parse(match[1].trim());
    if (!parsed || typeof parsed !== "object") return undefined;
    const rawQueries = Array.isArray((parsed as { queries?: unknown }).queries)
      ? (parsed as { queries: unknown[] }).queries
      : [];
    const queries = rawQueries
      .map(parseLookupQuery)
      .filter((q): q is LookupQuery => !!q)
      .slice(0, LOOKUP_MAX_QUERIES);
    if (queries.length === 0) return undefined;
    const reason =
      typeof (parsed as { reason?: unknown }).reason === "string" &&
      (parsed as { reason: string }).reason.trim()
        ? (parsed as { reason: string }).reason.trim()
        : undefined;
    return reason ? { reason, queries } : { queries };
  } catch {
    return undefined;
  }
}

function issueMatchesKeyword(issue: Issue, needle: string): boolean {
  const hay = [
    issue.id,
    issue.title,
    issue.charter.why,
    issue.charter.what,
    issue.charter.how,
    issue.tags.join(" "),
  ]
    .join("\n")
    .toLowerCase();
  return hay.includes(needle.toLowerCase());
}

function formatIssueBrief(issue: Issue, extra?: string): string {
  const why = issue.charter.why ? ` / Why: ${issue.charter.why.slice(0, 80)}` : "";
  const tags = issue.tags.length > 0 ? ` / タグ: ${issue.tags.join(", ")}` : "";
  const arch = issue.archived ? " / archived" : "";
  const suffix = extra ? ` ${extra}` : "";
  return `- [${issue.id}] ${issue.title}${why}${tags}（${issue.status}${arch}）${suffix}`;
}

function searchIssuesByKeyword(opts: {
  query: string;
  includeDone: boolean;
  includeArchived: boolean;
  limit: number;
}): { lines: string[]; totalMatched: number } {
  const needle = maskNames(opts.query.trim());
  if (!needle) return { lines: ["- （検索語が空です）"], totalMatched: 0 };

  const matched = listIssues().filter((i) => {
    if (!opts.includeArchived && i.archived) return false;
    if (!opts.includeDone && i.status === "done") return false;
    return issueMatchesKeyword(i, needle);
  });
  const sliced = matched.slice(0, opts.limit);
  if (matched.length === 0) {
    return {
      lines: [
        `- （キーワード「${needle}」に一致するIssueはありません。includeDone/includeArchived を true にすると範囲が広がります）`,
      ],
      totalMatched: 0,
    };
  }
  const lines = sliced.map((i) => formatIssueBrief(i));
  if (matched.length > sliced.length) {
    lines.push(`- …他 ${matched.length - sliced.length} 件（limit=${opts.limit}）`);
  }
  return { lines, totalMatched: matched.length };
}

function getIssueByIdLine(id: string): string[] {
  const trimmed = id.trim();
  const exact = getIssue(trimmed);
  if (exact) {
    return formatIssueDetailLines(exact);
  }
  const matched = findByIdPrefix(listIssues(), (i) => i.id, trimmed);
  if (matched.length === 1) {
    return formatIssueDetailLines(matched[0]);
  }
  if (matched.length > 1) {
    return [
      `- プレフィックス [${trimmed}] に複数の Issue が一致します:`,
      ...matched.map((i) => formatIssueBrief(i)),
    ];
  }
  return [`- Issue [${trimmed}] は見つかりませんでした`];
}

function formatIssueDetailLines(issue: Issue): string[] {
  const parts = [
    formatIssueBrief(issue),
    issue.charter.what ? `  What: ${issue.charter.what.slice(0, 200)}` : "",
    issue.charter.how ? `  How: ${issue.charter.how.slice(0, 200)}` : "",
    issue.actionItems.length > 0
      ? `  Action Items: ${issue.actionItems
          .slice(0, 5)
          .map((a) => `${a.done ? "[x]" : "[ ]"} ${a.text.slice(0, 60)}`)
          .join("; ")}`
      : "",
  ].filter(Boolean);
  return parts;
}

function searchJournalsByKeyword(opts: { query: string; limit: number }): { lines: string[]; total: number } {
  const { entries, total } = listJournalEntriesPage({ query: opts.query }, { limit: opts.limit, offset: 0 });
  if (total === 0) {
    return {
      lines: [`- （キーワード「${maskNames(opts.query)}」に一致するJournalはありません）`],
      total: 0,
    };
  }
  const lines = entries.map((e) => {
    const snippet = (e.summary || e.rawText || "").slice(0, 140);
    return `- [${e.id}] ${snippet}`;
  });
  if (total > entries.length) {
    lines.push(`- …他 ${total - entries.length} 件（limit=${opts.limit}）`);
  }
  return { lines, total };
}

async function searchSimilarBundle(opts: { query: string; limit: number }): Promise<string[]> {
  const query = maskNames(opts.query.trim());
  if (!query) return ["- （検索語が空です）"];

  let queryEmbedding: number[];
  try {
    queryEmbedding = await embedText(query);
  } catch {
    return ["- （埋め込み生成に失敗したため類似検索できませんでした）"];
  }

  const issues = searchSimilarOpenIssues(queryEmbedding, {
    limit: opts.limit,
    threshold: RELATED_SIMILARITY_THRESHOLD,
  });
  // done/archived も含めて広めに見る（不在確認用）。embedding があるものだけ。
  const allScored: SimilarIssue[] = listIssues()
    .filter((i) => i.embedding)
    .map((i) => ({
      ...i,
      similarity: cosineSimilarity(queryEmbedding, i.embedding!),
    }))
    .filter((i) => i.similarity >= RELATED_SIMILARITY_THRESHOLD)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, opts.limit);

  const journals = searchSimilarEvents(queryEmbedding, { kind: "fact", limit: opts.limit }).filter(
    (e) => e.entityType === "journal" && e.similarity >= RELATED_SIMILARITY_THRESHOLD,
  );

  const lines: string[] = [];
  lines.push("【類似・未完了Issue】");
  if (issues.length === 0) {
    lines.push("- （閾値以上の未完了Issueなし）");
  } else {
    lines.push(...issues.map((i) => formatIssueBrief(i, `（類似度: ${i.similarity.toFixed(2)}）`)));
  }

  lines.push("【類似・状態不問のIssue（done/archived含む）】");
  if (allScored.length === 0) {
    lines.push("- （閾値以上のIssueなし）");
  } else {
    lines.push(...allScored.map((i) => formatIssueBrief(i, `（類似度: ${i.similarity.toFixed(2)}）`)));
  }

  lines.push("【類似Journal】");
  if (journals.length === 0) {
    lines.push("- （閾値以上のJournalなし）");
  } else {
    for (const e of journals) {
      const snippet = (e.summary || e.text).slice(0, 140);
      lines.push(`- [${e.id}] ${snippet}（類似度: ${e.similarity.toFixed(2)}）`);
    }
  }
  return lines;
}

async function runOneQuery(q: LookupQuery, index: number): Promise<string> {
  const header = `### 照会 ${index + 1}: ${q.type}`;
  if (q.type === "issues") {
    const { lines, totalMatched } = searchIssuesByKeyword({
      query: q.query,
      includeDone: q.includeDone === true,
      includeArchived: q.includeArchived === true,
      limit: q.limit ?? LOOKUP_DEFAULT_LIMIT,
    });
    return [
      header,
      `クエリ: ${maskNames(q.query)} / includeDone=${q.includeDone === true} / includeArchived=${q.includeArchived === true} / ヒット=${totalMatched}`,
      ...lines,
    ].join("\n");
  }
  if (q.type === "issue") {
    return [header, `id: ${q.id}`, ...getIssueByIdLine(q.id)].join("\n");
  }
  if (q.type === "journals") {
    const { lines, total } = searchJournalsByKeyword({
      query: q.query,
      limit: q.limit ?? LOOKUP_DEFAULT_LIMIT,
    });
    return [header, `クエリ: ${maskNames(q.query)} / ヒット=${total}`, ...lines].join("\n");
  }
  // similar
  const lines = await searchSimilarBundle({
    query: q.query,
    limit: q.limit ?? LOOKUP_DEFAULT_LIMIT,
  });
  return [header, `クエリ: ${maskNames(q.query)}`, ...lines].join("\n");
}

/** LookupRequest を実行し、エージェント向け（マスク済み）テキストを返す。 */
export async function executeLookup(request: LookupRequest): Promise<string> {
  const blocks: string[] = [];
  if (request.reason) {
    blocks.push(`照会理由: ${request.reason}`);
  }
  for (let i = 0; i < request.queries.length; i++) {
    blocks.push(await runOneQuery(request.queries[i], i));
  }
  return [
    "【追加照会結果】（アプリ内の読み取り専用検索。secure/実名対応表にはアクセスしていません）",
    ...blocks,
  ].join("\n\n");
}
