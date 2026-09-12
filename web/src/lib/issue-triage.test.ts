import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  computeTriageScore,
  needsTriageRescore,
  parseTriageAiScores,
  scoreIssueHeuristically,
  scoreIssueTriage,
  scoreIssuesTriageBatch,
  suggestedPriorityFromScore,
  TRIAGE_AI_BATCH_LIMIT,
} from "@/lib/issue-triage";
import type { Issue } from "@/lib/issue-store";
import { runCloudChat } from "@/lib/cloud-chat";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "@/lib/test-helpers/store-env";

vi.mock("@/lib/cloud-chat", () => ({
  runCloudChat: vi.fn(),
}));

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
  let dir: string;

  beforeEach(() => {
    dir = setupIsolatedStoreEnv();
    vi.mocked(runCloudChat).mockReset();
  });

  afterEach(() => {
    teardownIsolatedStoreEnv(dir);
  });

  it("score は CoD×Blast/Effort×Confidence で上がる", () => {
    const low = computeTriageScore({ costOfDelay: 0.2, effort: 0.8, blastRadius: 0.2, confidence: 0.5 });
    const high = computeTriageScore({ costOfDelay: 0.9, effort: 0.2, blastRadius: 0.9, confidence: 0.9 });
    expect(high).toBeGreaterThan(low);
  });

  it("テーマ・KR リンクと blocked で focus 寄りになる（heuristic）", () => {
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
    expect(scored.source).toBe("heuristic");
  });

  it("長期未更新・材料薄い Issue は parked 候補になりうる（heuristic）", () => {
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

  it("needsTriageRescore: 未更新はスキップ、force と更新後は再評価", () => {
    const now = 1_000_000;
    const withTriage = baseIssue({
      updatedAt: now - 1000,
      triage: {
        costOfDelay: 0.5,
        effort: 0.4,
        blastRadius: 0.4,
        confidence: 0.5,
        score: 0.25,
        suggestedPriority: "normal",
        scoredAt: now,
        source: "ai",
      },
    });
    expect(needsTriageRescore(withTriage)).toBe(false);
    expect(needsTriageRescore(withTriage, { force: true })).toBe(true);

    const updated = { ...withTriage, updatedAt: now + 1 };
    expect(needsTriageRescore(updated)).toBe(true);
    expect(needsTriageRescore(baseIssue({ triage: undefined }))).toBe(true);
  });

  it("parseTriageAiScores は妥当な行だけ通す", () => {
    const map = parseTriageAiScores({
      scores: [
        { issueId: "a", costOfDelay: 0.8, effort: 0.3, blastRadius: 0.7, confidence: 0.6 },
        { issueId: "b", costOfDelay: "x", effort: 0.3, blastRadius: 0.7, confidence: 0.6 },
        { costOfDelay: 0.5, effort: 0.5, blastRadius: 0.5, confidence: 0.5 },
      ],
    });
    expect(map.size).toBe(1);
    expect(map.get("a")?.costOfDelay).toBe(0.8);
  });

  it("scoreIssueTriage は AI 成功時に source=ai", async () => {
    vi.mocked(runCloudChat).mockResolvedValueOnce(
      JSON.stringify({
        scores: [{ issueId: "i1", costOfDelay: 0.85, effort: 0.4, blastRadius: 0.7, confidence: 0.75 }],
      }),
    );
    const result = await scoreIssueTriage(baseIssue({ id: "i1" }), { force: true });
    expect(result.skipped).toBe(false);
    expect(result.triage.source).toBe("ai");
    expect(result.triage.costOfDelay).toBe(0.85);
  });

  it("scoreIssueTriage は未更新ならスキップ", async () => {
    const now = Date.now();
    const issue = baseIssue({
      updatedAt: now - 10,
      triage: {
        costOfDelay: 0.4,
        effort: 0.4,
        blastRadius: 0.4,
        confidence: 0.5,
        score: 0.2,
        suggestedPriority: "normal",
        scoredAt: now,
        source: "ai",
      },
    });
    const result = await scoreIssueTriage(issue, { force: false, now });
    expect(result.skipped).toBe(true);
    expect(runCloudChat).not.toHaveBeenCalled();
  });

  it("scoreIssueTriage は AI 失敗時 heuristic", async () => {
    vi.mocked(runCloudChat).mockRejectedValueOnce(new Error("cli down"));
    const result = await scoreIssueTriage(baseIssue(), { force: true });
    expect(result.triage.source).toBe("heuristic");
  });

  it("scoreIssuesTriageBatch は未更新をスキップし上限を守る", async () => {
    vi.mocked(runCloudChat).mockResolvedValue(JSON.stringify({ scores: [] }));
    const now = Date.now();
    const stale = baseIssue({
      id: "stale",
      updatedAt: now - 100,
      triage: {
        costOfDelay: 0.3,
        effort: 0.3,
        blastRadius: 0.3,
        confidence: 0.5,
        score: 0.15,
        suggestedPriority: "parked",
        scoredAt: now,
        source: "ai",
      },
    });
    const freshList = Array.from({ length: TRIAGE_AI_BATCH_LIMIT + 2 }, (_, i) =>
      baseIssue({
        id: `n${i}`,
        title: `新規${i}`,
        updatedAt: now,
        triage: undefined,
      }),
    );
    const batch = await scoreIssuesTriageBatch([stale, ...freshList], {
      now,
      force: false,
      batchLimit: TRIAGE_AI_BATCH_LIMIT,
    });
    expect(batch.skippedUnchangedIds).toEqual(["stale"]);
    expect(batch.deferredIds.length).toBe(2);
    // AI 上限分 + deferred で triage 無しの heuristic 採点
    expect(batch.rescoredIds.length).toBe(TRIAGE_AI_BATCH_LIMIT + 2);
    expect(runCloudChat).toHaveBeenCalledTimes(1);
  });
});
