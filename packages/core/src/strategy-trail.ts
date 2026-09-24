// 提案→Journalという縦の接続を、Suggestion.sourceJournalId・JournalEntry.resolvedSuggestionIdという
// ライブな外部キーから都度組み立てる。

import type { Suggestion, JournalEntry } from "./types";

export type StrategyTrailNode = { kind: "suggestion"; id: string; label: string } | { kind: "journal"; id: string; label: string };

/** 提案詳細向け: 提案（現在地）のみの単一ノード。 */
export function buildSuggestionStrategyTrail(suggestion: Pick<Suggestion, "id" | "title">): StrategyTrailNode[] {
  return [{ kind: "suggestion", id: suggestion.id, label: suggestion.title }];
}

/**
 * Journal向け: 提案 › Journal（現在地）。resolvedSuggestionIdが無ければ空配列
 * （＝まだ提案に追跡されていない＝戦略への接続が無い）。
 */
export function buildJournalStrategyTrail(
  entry: Pick<JournalEntry, "id" | "resolvedSuggestionId" | "resolvedSuggestionTitle">,
  suggestions: Pick<Suggestion, "id" | "title">[],
): StrategyTrailNode[] {
  if (!entry.resolvedSuggestionId) return [];
  const suggestion = suggestions.find((s) => s.id === entry.resolvedSuggestionId);
  const suggestionNode: StrategyTrailNode = suggestion
    ? { kind: "suggestion", id: suggestion.id, label: suggestion.title }
    : { kind: "suggestion", id: entry.resolvedSuggestionId, label: entry.resolvedSuggestionTitle ?? "(不明)" };
  return [suggestionNode, { kind: "journal", id: entry.id, label: "このJournal" }];
}
