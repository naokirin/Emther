import { describe, expect, it } from "vitest";
import { buildIssueStrategyTrail, buildJournalStrategyTrail } from "./strategy-trail";
import type { Issue, JournalEntry, ObjectiveWithProgress } from "./types";

const objectives: ObjectiveWithProgress[] = [
  {
    id: "obj-1",
    title: "エンジニア満足度向上",
    keyResults: [{ id: "kr-1", title: "1on1カバレッジ90%" }],
    createdAt: 0,
    updatedAt: 0,
    progress: [{ keyResultId: "kr-1", total: 1, done: 0 }],
  },
];

describe("buildIssueStrategyTrail", () => {
  it("keyResultId未設定ならIssueノードのみ", () => {
    const issue = { id: "issue-1", title: "Bチーム1on1不足", keyResultId: undefined };
    expect(buildIssueStrategyTrail(issue, objectives)).toEqual([{ kind: "issue", id: "issue-1", label: "Bチーム1on1不足" }]);
  });

  it("keyResultIdがあればObjective › KeyResult › Issueの順で返す", () => {
    const issue = { id: "issue-1", title: "Bチーム1on1不足", keyResultId: "kr-1" };
    expect(buildIssueStrategyTrail(issue, objectives)).toEqual([
      { kind: "objective", id: "obj-1", label: "エンジニア満足度向上" },
      { kind: "keyResult", id: "kr-1", label: "1on1カバレッジ90%", objectiveId: "obj-1" },
      { kind: "issue", id: "issue-1", label: "Bチーム1on1不足" },
    ]);
  });

  it("keyResultIdが解決できないIDなら上位ノードを出さない", () => {
    const issue = { id: "issue-1", title: "不明", keyResultId: "kr-missing" };
    expect(buildIssueStrategyTrail(issue, objectives)).toEqual([{ kind: "issue", id: "issue-1", label: "不明" }]);
  });
});

describe("buildJournalStrategyTrail", () => {
  const issues: Pick<Issue, "id" | "title" | "keyResultId">[] = [
    { id: "issue-1", title: "Bチーム1on1不足", keyResultId: "kr-1" },
  ];

  it("resolvedIssueId未設定なら空配列（戦略へ未接続）", () => {
    const entry = { id: "journal-1", resolvedIssueId: undefined, resolvedIssueTitle: undefined };
    expect(buildJournalStrategyTrail(entry, issues, objectives)).toEqual([]);
  });

  it("resolvedIssueIdからObjective › KeyResult › Issue › Journalまで組み立てる", () => {
    const entry = { id: "journal-1", resolvedIssueId: "issue-1", resolvedIssueTitle: "Bチーム1on1不足" };
    expect(buildJournalStrategyTrail(entry, issues, objectives)).toEqual([
      { kind: "objective", id: "obj-1", label: "エンジニア満足度向上" },
      { kind: "keyResult", id: "kr-1", label: "1on1カバレッジ90%", objectiveId: "obj-1" },
      { kind: "issue", id: "issue-1", label: "Bチーム1on1不足" },
      { kind: "journal", id: "journal-1", label: "このJournal" },
    ]);
  });

  it("issues配列にIssueが見つからなくてもresolvedIssueTitleでIssueノードだけは出す", () => {
    const entry: Pick<JournalEntry, "id" | "resolvedIssueId" | "resolvedIssueTitle"> = {
      id: "journal-1",
      resolvedIssueId: "issue-unknown",
      resolvedIssueTitle: "消えたIssue",
    };
    expect(buildJournalStrategyTrail(entry, issues, objectives)).toEqual([
      { kind: "issue", id: "issue-unknown", label: "消えたIssue" },
      { kind: "journal", id: "journal-1", label: "このJournal" },
    ]);
  });
});
