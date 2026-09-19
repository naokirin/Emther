// docs/memo.md「Journal・Issue・方針目標・ふりかえりを行き来し続ける認知負荷」対応。
// 戦略（Objective/KeyResult）→Issue→Journalという縦の接続を、OrgTheme.evidence*（作成時
// 一度きりのAIスナップショットで鮮度が腐る）ではなく、Issue.keyResultId／sourceJournalId・
// JournalEntry.resolvedIssueIdというライブな外部キーから都度組み立てる。

import type { Issue, JournalEntry, ObjectiveWithProgress } from "@core/types";

export type StrategyTrailNode =
  | { kind: "objective"; id: string; label: string }
  | { kind: "keyResult"; id: string; label: string; objectiveId: string }
  | { kind: "issue"; id: string; label: string }
  | { kind: "journal"; id: string; label: string };

function objectiveKeyResultNodes(
  issue: Pick<Issue, "keyResultId">,
  objectives: ObjectiveWithProgress[],
): StrategyTrailNode[] {
  if (!issue.keyResultId) return [];
  for (const o of objectives) {
    const kr = o.keyResults.find((k) => k.id === issue.keyResultId);
    if (kr) {
      return [
        { kind: "objective", id: o.id, label: o.title },
        { kind: "keyResult", id: kr.id, label: kr.title, objectiveId: o.id },
      ];
    }
  }
  return [];
}

/** Issue詳細向け: Objective › KeyResult › Issue（現在地）。keyResultId未設定ならIssueのみ。 */
export function buildIssueStrategyTrail(
  issue: Pick<Issue, "id" | "title" | "keyResultId">,
  objectives: ObjectiveWithProgress[],
): StrategyTrailNode[] {
  return [...objectiveKeyResultNodes(issue, objectives), { kind: "issue", id: issue.id, label: issue.title }];
}

/**
 * Journal向け: Objective › KeyResult › Issue › Journal（現在地）。resolvedIssueIdが
 * 無ければ空配列（＝まだIssueに追跡されていない＝戦略への接続が無い）。
 */
export function buildJournalStrategyTrail(
  entry: Pick<JournalEntry, "id" | "resolvedIssueId" | "resolvedIssueTitle">,
  issues: Pick<Issue, "id" | "title" | "keyResultId">[],
  objectives: ObjectiveWithProgress[],
): StrategyTrailNode[] {
  if (!entry.resolvedIssueId) return [];
  const issue = issues.find((i) => i.id === entry.resolvedIssueId);
  const issueNode: StrategyTrailNode = issue
    ? { kind: "issue", id: issue.id, label: issue.title }
    : { kind: "issue", id: entry.resolvedIssueId, label: entry.resolvedIssueTitle ?? "(不明)" };
  const upNodes = issue ? objectiveKeyResultNodes(issue, objectives) : [];
  return [...upNodes, issueNode, { kind: "journal", id: entry.id, label: "このJournal" }];
}
