import { cosineSimilarity, embedText } from "@/lib/embeddings";
import { listIssues, getIssue, persistIssueEmbedding, type Issue } from "@/lib/issue-store";
import { searchSimilarEvents, type KnowledgeEvent } from "@/lib/knowledge-store";
import { unmaskNames } from "@/lib/people-directory";
import { getRulesAndConstraints } from "@/lib/settings-store";

// docs/knowledge_distillation.md 後続 1・2。
// Issue の embedding と、Journal/Issue 横断の「関連束」＋繰り返しカウントを組み立て、
// Agent プロンプトへ注入する。巨大な本文を run.task に載せない（U13 と同じ方針）。

export const RELATED_SIMILARITY_THRESHOLD = 0.4;
const RELATED_JOURNAL_LIMIT = 5;
const RELATED_ISSUE_LIMIT = 5;
/** 関連束の繰り返しカウント用。表示用 journals より広く走査するが、1クエリにまとめる。 */
const RELATED_FACT_SCAN_LIMIT = 50;

export function issueEmbedSource(issue: Pick<Issue, "title" | "charter" | "tags">): string {
  const parts = [
    unmaskNames(issue.title),
    issue.charter.why ? `Why: ${unmaskNames(issue.charter.why)}` : "",
    issue.charter.what ? `What: ${unmaskNames(issue.charter.what)}` : "",
    issue.charter.how ? `How: ${unmaskNames(issue.charter.how)}` : "",
    issue.tags.length > 0 ? `タグ: ${issue.tags.join(", ")}` : "",
  ].filter(Boolean);
  return parts.join("\n");
}

/** embedding を再計算して Issue に保存する（updatedAt は変えない）。失敗時は握りつぶす。 */
export async function refreshIssueEmbedding(issueId: string): Promise<Issue | undefined> {
  const issue = getIssue(issueId);
  if (!issue) return undefined;
  try {
    const embedding = await embedText(issueEmbedSource(issue));
    return persistIssueEmbedding(issueId, embedding);
  } catch {
    return getIssue(issueId);
  }
}

export type SimilarIssue = Issue & { similarity: number };

export function searchSimilarOpenIssues(
  queryEmbedding: number[],
  opts?: { excludeId?: string; limit?: number; threshold?: number },
): SimilarIssue[] {
  const limit = opts?.limit ?? RELATED_ISSUE_LIMIT;
  const threshold = opts?.threshold ?? RELATED_SIMILARITY_THRESHOLD;
  return listIssues()
    .filter((i) => !i.archived && i.status !== "done" && i.embedding && i.id !== opts?.excludeId)
    .map((i) => ({ ...i, similarity: cosineSimilarity(queryEmbedding, i.embedding!) }))
    .filter((i) => i.similarity >= threshold)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}

export type RelatedBundle = {
  journals: Array<KnowledgeEvent & { similarity: number }>;
  issues: SimilarIssue[];
  /** 類似 Journal（閾値以上）の件数。繰り返しシグナル。 */
  recurrenceCount: number;
};

export async function gatherRelatedBundle(opts: {
  queryText: string;
  excludeIssueId?: string;
}): Promise<RelatedBundle> {
  const empty: RelatedBundle = { journals: [], issues: [], recurrenceCount: 0 };
  const query = opts.queryText.trim();
  if (!query) return empty;

  let queryEmbedding: number[];
  try {
    queryEmbedding = await embedText(query);
  } catch {
    return empty;
  }

  // 表示用（上位5件）と繰り返しカウント（上位50件）を1回の検索にまとめる。
  const scoredFacts = searchSimilarEvents(queryEmbedding, { kind: "fact", limit: RELATED_FACT_SCAN_LIMIT });

  const journals = scoredFacts
    .slice(0, RELATED_JOURNAL_LIMIT)
    .filter((e) => e.entityType === "journal" && e.similarity >= RELATED_SIMILARITY_THRESHOLD);

  const recurrenceWindowDays = getRulesAndConstraints().journalFactTtlDays;
  const since = Date.now() - recurrenceWindowDays * 24 * 60 * 60 * 1000;
  const recurrenceCount = scoredFacts.filter(
    (e) =>
      e.entityType === "journal" &&
      e.similarity >= RELATED_SIMILARITY_THRESHOLD &&
      e.occurredAt >= since,
  ).length;

  const issues = searchSimilarOpenIssues(queryEmbedding, { excludeId: opts.excludeIssueId });

  return { journals, issues, recurrenceCount };
}

function formatJournalLine(e: KnowledgeEvent & { similarity: number }): string {
  const snippet = (e.summary || e.text).slice(0, 140);
  return `- [${e.id}] ${snippet}（類似度: ${e.similarity.toFixed(2)}）`;
}

function formatIssueLine(i: SimilarIssue): string {
  const why = i.charter.why ? ` / Why: ${i.charter.why.slice(0, 60)}` : "";
  return `- [${i.id}] ${i.title}${why}（類似度: ${i.similarity.toFixed(2)} / ${i.status}）`;
}

export type RelatedBundleMode = "issue-wallbash" | "journal-analysis";

export async function buildRelatedBundleBlock(opts: {
  queryText: string;
  excludeIssueId?: string;
  mode: RelatedBundleMode;
}): Promise<string> {
  const bundle = await gatherRelatedBundle({
    queryText: opts.queryText,
    excludeIssueId: opts.excludeIssueId,
  });
  if (bundle.journals.length === 0 && bundle.issues.length === 0 && bundle.recurrenceCount === 0) {
    return "";
  }

  const lines: string[] = [];
  if (opts.mode === "journal-analysis") {
    lines.push(
      "関連する過去の状況（ベクトル類似。単発か構造課題かの判断材料。確度は類似度を見て参考程度に）:",
    );
    if (bundle.recurrenceCount >= 2) {
      lines.push(
        `【繰り返しシグナル】直近の有効期間内で意味的に近い Journal が ${bundle.recurrenceCount} 件あります（2件以上なら構造課題・既存Issueの続きの可能性を優先して検討すること）。`,
      );
    } else if (bundle.recurrenceCount === 1) {
      lines.push("【繰り返しシグナル】近い Journal はこの件を含めて1件程度（単発の可能性も残る）。");
    }
  } else {
    lines.push(
      "このIssueに意味的に関連する過去の情報（ベクトル類似。横断の材料として扱うこと。確度は類似度を見て参考程度に）:",
    );
  }

  if (bundle.issues.length > 0) {
    lines.push("", "【関連する未完了Issue】");
    lines.push(...bundle.issues.map(formatIssueLine));
  }
  if (bundle.journals.length > 0) {
    lines.push("", "【関連するJournal】");
    lines.push(...bundle.journals.map(formatJournalLine));
  }

  return lines.join("\n");
}
