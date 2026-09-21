// docs/memo.md「Journal・Issue・方針目標・ふりかえりを行き来し続ける認知負荷」対応。
// Issue→Journalという縦の接続を、Issue.sourceJournalId・JournalEntry.resolvedIssueIdという
// ライブな外部キーから都度組み立てる。

import type { Issue, JournalEntry } from "./types";

export type StrategyTrailNode = { kind: "issue"; id: string; label: string } | { kind: "journal"; id: string; label: string };

/** Issue詳細向け: Issue（現在地）のみの単一ノード。 */
export function buildIssueStrategyTrail(issue: Pick<Issue, "id" | "title">): StrategyTrailNode[] {
  return [{ kind: "issue", id: issue.id, label: issue.title }];
}

/**
 * Journal向け: Issue › Journal（現在地）。resolvedIssueIdが無ければ空配列
 * （＝まだIssueに追跡されていない＝戦略への接続が無い）。
 */
export function buildJournalStrategyTrail(
  entry: Pick<JournalEntry, "id" | "resolvedIssueId" | "resolvedIssueTitle">,
  issues: Pick<Issue, "id" | "title">[],
): StrategyTrailNode[] {
  if (!entry.resolvedIssueId) return [];
  const issue = issues.find((i) => i.id === entry.resolvedIssueId);
  const issueNode: StrategyTrailNode = issue
    ? { kind: "issue", id: issue.id, label: issue.title }
    : { kind: "issue", id: entry.resolvedIssueId, label: entry.resolvedIssueTitle ?? "(不明)" };
  return [issueNode, { kind: "journal", id: entry.id, label: "このJournal" }];
}
