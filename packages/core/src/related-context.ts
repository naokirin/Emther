import { cosineSimilarity, embedText } from "./embeddings";
import { listSuggestions } from "./suggestion-store";
import type { Suggestion } from "./types";
import { searchSimilarEvents, type KnowledgeEvent } from "./knowledge-store";
import { getRulesAndConstraints } from "./settings-store";
import { maybeRerankByText, RERANK_CANDIDATE_LIMIT } from "./reranker";

// 提案の embedding と、Journal/提案 横断の「関連束」＋繰り返しカウントを組み立て、
// Agent プロンプトへ注入する。巨大な本文を run.task に載せない。
// 提案自身のembedding計算・永続化（refreshSuggestionEmbedding）はsuggestion-store.ts
// 側にある（related-context⇄suggestion-storeの循環参照を避けるため）。
// localRerankEnabled（既定OFF）時は、cosine で足切りした候補を tiny reranker で並べ替えてから
// 上位を取る。繰り返しカウントは cosine のまま。

export const RELATED_SIMILARITY_THRESHOLD = 0.4;
const RELATED_JOURNAL_LIMIT = 5;
const RELATED_SUGGESTION_LIMIT = 5;
/** 関連束の繰り返しカウント用。表示用 journals より広く走査するが、1クエリにまとめる。 */
const RELATED_FACT_SCAN_LIMIT = 50;

export type SimilarSuggestion = Suggestion & { similarity: number };

export function searchSimilarOpenSuggestions(
  queryEmbedding: number[],
  opts?: { excludeId?: string; limit?: number; threshold?: number },
): SimilarSuggestion[] {
  const limit = opts?.limit ?? RELATED_SUGGESTION_LIMIT;
  const threshold = opts?.threshold ?? RELATED_SIMILARITY_THRESHOLD;
  return listSuggestions()
    .filter((s) => !s.archivedAt && s.reviewStatus !== "done" && s.embedding && s.id !== opts?.excludeId)
    .map((s) => ({ ...s, similarity: cosineSimilarity(queryEmbedding, s.embedding!) }))
    .filter((s) => s.similarity >= threshold)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}

export type RelatedBundle = {
  journals: Array<KnowledgeEvent & { similarity: number }>;
  suggestions: SimilarSuggestion[];
  /** 類似 Journal（閾値以上）の件数。繰り返しシグナル。 */
  recurrenceCount: number;
};

export async function gatherRelatedBundle(opts: {
  queryText: string;
  excludeSuggestionId?: string;
}): Promise<RelatedBundle> {
  const empty: RelatedBundle = { journals: [], suggestions: [], recurrenceCount: 0 };
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

  const journalPool = scoredFacts
    .filter((e) => e.entityType === "journal" && e.similarity >= RELATED_SIMILARITY_THRESHOLD)
    .slice(0, RERANK_CANDIDATE_LIMIT);
  const journals = (
    await maybeRerankByText(query, journalPool, (e) => e.summary || e.text)
  ).slice(0, RELATED_JOURNAL_LIMIT);

  const recurrenceWindowDays = getRulesAndConstraints().journalFactTtlDays;
  const since = Date.now() - recurrenceWindowDays * 24 * 60 * 60 * 1000;
  const recurrenceCount = scoredFacts.filter(
    (e) =>
      e.entityType === "journal" &&
      e.similarity >= RELATED_SIMILARITY_THRESHOLD &&
      e.occurredAt >= since,
  ).length;

  const suggestionPool = searchSimilarOpenSuggestions(queryEmbedding, {
    excludeId: opts.excludeSuggestionId,
    limit: RERANK_CANDIDATE_LIMIT,
  });
  const suggestions = (
    await maybeRerankByText(query, suggestionPool, (s) => {
      const memo = s.memos.at(-1)?.text ?? "";
      return [s.title, memo].filter(Boolean).join(" ");
    })
  ).slice(0, RELATED_SUGGESTION_LIMIT);

  return { journals, suggestions, recurrenceCount };
}

function formatJournalLine(e: KnowledgeEvent & { similarity: number }): string {
  const snippet = (e.summary || e.text).slice(0, 140);
  return `- [${e.id}] ${snippet}（類似度: ${e.similarity.toFixed(2)}）`;
}

function formatSuggestionLine(s: SimilarSuggestion): string {
  const memo = s.memos.at(-1)?.text ? ` / メモ: ${s.memos.at(-1)!.text.slice(0, 60)}` : "";
  return `- [${s.id}] ${s.title}${memo}（類似度: ${s.similarity.toFixed(2)} / ${s.reviewStatus}）`;
}

export type RelatedBundleMode = "suggestion-wallbash" | "journal-analysis";

export async function buildRelatedBundleBlock(opts: {
  queryText: string;
  excludeSuggestionId?: string;
  mode: RelatedBundleMode;
}): Promise<string> {
  if (!opts.queryText.trim()) return "";

  const bundle = await gatherRelatedBundle({
    queryText: opts.queryText,
    excludeSuggestionId: opts.excludeSuggestionId,
  });

  // 空でも沈黙しない。「無い」を明示し、必要なら lookup で追加確認できる旨を伝える。
  // （以前は空文字を返しており、エージェントが「注入されていない＝分からない」としか言えなかった）
  const lines: string[] = [];
  if (opts.mode === "journal-analysis") {
    lines.push(
      "関連する過去の状況（ベクトル類似の上位最大5件・閾値以上のみ。単発か構造課題かの判断材料。確度は類似度を見て参考程度に。打ち切り外の確認はlookupを使うこと）:",
    );
    if (bundle.recurrenceCount >= 2) {
      lines.push(
        `【繰り返しシグナル】直近の有効期間内で意味的に近い Journal が ${bundle.recurrenceCount} 件あります（2件以上なら構造課題・既存提案の続きの可能性を優先して検討すること）。`,
      );
    } else if (bundle.recurrenceCount === 1) {
      lines.push("【繰り返しシグナル】近い Journal はこの件を含めて1件程度（単発の可能性も残る）。");
    } else {
      lines.push("【繰り返しシグナル】閾値以上の近い Journal は見つかりませんでした。");
    }
  } else {
    lines.push(
      "この提案に意味的に関連する過去の情報（ベクトル類似の上位最大5件・閾値以上のみ。横断の材料として扱うこと。確度は類似度を見て参考程度に。打ち切り外・完了済みの確認はlookupを使うこと）:",
    );
  }

  lines.push("", "【関連する未完了の提案】");
  if (bundle.suggestions.length > 0) {
    lines.push(...bundle.suggestions.map(formatSuggestionLine));
  } else {
    lines.push("- （閾値以上の類似未完了提案なし。不在の確証が必要なら lookup でキーワード検索や done/archived 込みの確認を行うこと）");
  }

  lines.push("", "【関連するJournal】");
  if (bundle.journals.length > 0) {
    lines.push(...bundle.journals.map(formatJournalLine));
  } else {
    lines.push("- （閾値以上の類似Journalなし）");
  }

  return lines.join("\n");
}
