import { describe, expect, it } from "vitest";
import { computeTriageScore, scoreIssueHeuristically, suggestedPriorityFromScore } from "@/lib/issue-triage";
import type { Issue } from "@/lib/issue-store";

function baseIssue(overrides: Partial<Issue> = {}): Issue {
  const now = Date.now();
  return {
    id: "i1",
    title: "承認ボトルネック",
    charter: { why: "リリース遅延", what: "承認フロー見直し", how: "RACI整理" },
    actionItems: [],
    logEntries: [],
    status: "in_progress",
    priority: "normal",
    archived: false,
    tags: ["組織"],
    createdAt: now - 3 * 24 * 60 * 60 * 1000,
    updatedAt: now - 1 * 24 * 60 * 60 * 1000,
    ...overrides,
  };
}

describe("issue-triage", () => {
  it("score は CoD×Blast/Effort×Confidence で上がる", () => {
    const low = computeTriageScore({ costOfDelay: 0.2, effort: 0.8, blastRadius: 0.2, confidence: 0.5 });
    const high = computeTriageScore({ costOfDelay: 0.9, effort: 0.2, blastRadius: 0.9, confidence: 0.9 });
    expect(high).toBeGreaterThan(low);
  });

  it("テーマ・KR リンクと blocked で focus 寄りになる", () => {
    const scored = scoreIssueHeuristically(
      baseIssue({
        status: "blocked",
        themeId: "th1",
        keyResultId: "kr1",
        teamId: "t1",
        tags: ["リスク", "組織"],
        sourceJournalId: "j1",
      }),
    );
    expect(scored.costOfDelay).toBeGreaterThan(0.5);
    expect(scored.blastRadius).toBeGreaterThan(0.5);
    expect(scored.suggestedPriority).toBe("focus");
  });

  it("長期未更新・材料薄い Issue は parked 候補になりうる", () => {
    const now = Date.now();
    const scored = scoreIssueHeuristically(
      baseIssue({
        charter: { why: "", what: "", how: "" },
        status: "not_started",
        tags: [],
        createdAt: now - 40 * 24 * 60 * 60 * 1000,
        updatedAt: now - 20 * 24 * 60 * 60 * 1000,
      }),
      { now },
    );
    expect(scored.suggestedPriority).toBe("parked");
  });

  it("suggestedPriorityFromScore の閾値", () => {
    expect(suggestedPriorityFromScore(0.6, false)).toBe("focus");
    expect(suggestedPriorityFromScore(0.3, false)).toBe("normal");
    expect(suggestedPriorityFromScore(0.1, false)).toBe("parked");
    expect(suggestedPriorityFromScore(0.4, true)).toBe("parked");
  });
});
