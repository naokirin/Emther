import { describe, expect, it } from "vitest";
import { buildIssueStrategyTrail, buildJournalStrategyTrail } from "./strategy-trail";
import type { Issue, JournalEntry } from "./types";

describe("buildIssueStrategyTrail", () => {
  it("Issueノードのみを返す", () => {
    const issue = { id: "issue-1", title: "Bチーム1on1不足" };
    expect(buildIssueStrategyTrail(issue)).toEqual([{ kind: "issue", id: "issue-1", label: "Bチーム1on1不足" }]);
  });
});

describe("buildJournalStrategyTrail", () => {
  const issues: Pick<Issue, "id" | "title">[] = [{ id: "issue-1", title: "Bチーム1on1不足" }];

  it("resolvedIssueId未設定なら空配列（戦略へ未接続）", () => {
    const entry = { id: "journal-1", resolvedIssueId: undefined, resolvedIssueTitle: undefined };
    expect(buildJournalStrategyTrail(entry, issues)).toEqual([]);
  });

  it("resolvedIssueIdからIssue › Journalまで組み立てる", () => {
    const entry = { id: "journal-1", resolvedIssueId: "issue-1", resolvedIssueTitle: "Bチーム1on1不足" };
    expect(buildJournalStrategyTrail(entry, issues)).toEqual([
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
    expect(buildJournalStrategyTrail(entry, issues)).toEqual([
      { kind: "issue", id: "issue-unknown", label: "消えたIssue" },
      { kind: "journal", id: "journal-1", label: "このJournal" },
    ]);
  });
});
