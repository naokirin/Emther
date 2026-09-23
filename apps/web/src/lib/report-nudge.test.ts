import { describe, expect, it } from "vitest";
import { selectReportNudges, type ReportNudgeKind } from "./report-nudge";
import type { AgentRun } from "@emther/core/agent-runtime";

function run(overrides: Partial<AgentRun> & { origin: AgentRun["origin"] }): AgentRun {
  return {
    id: "r1",
    agentName: "Lead Agent",
    task: "report",
    status: "idle",
    log: [],
    totalCostUsd: 0,
    createdAt: 0,
    updatedAt: 1000,
    reviewed: true,
    periodReview: {
      overview: "概観",
      observations: [],
      interpretation: "",
      comparisons: [],
      blindSpots: [],
      learnings: [],
      nextQuestions: [],
    },
    ...overrides,
  };
}

describe("selectReportNudges", () => {
  const seen = new Set<string>();
  const isSeen = (kind: ReportNudgeKind, periodKey: string) => seen.has(`${kind}:${periodKey}`);

  it("月曜に未読の週次レビューがあれば案内する", () => {
    // 2026-09-21 は月曜
    const now = new Date(2026, 8, 21, 9, 0, 0).getTime();
    const result = selectReportNudges({
      now,
      runs: [run({ id: "w1", origin: "auto-weekly-report" })],
      isSeen,
    });
    expect(result.primary?.kind).toBe("weekly");
    expect(result.secondary).toBeNull();
  });

  it("月初に未読の月次レビューがあれば案内する", () => {
    // 2026-09-02 は水曜・月初
    const now = new Date(2026, 8, 2, 9, 0, 0).getTime();
    const result = selectReportNudges({
      now,
      runs: [run({ id: "m1", origin: "auto-monthly-report" })],
      isSeen,
    });
    expect(result.primary?.kind).toBe("monthly");
  });

  it("月曜かつ月初は週次を主・月次を副にする", () => {
    // 2026-09-07 は月曜かつ月初5日以内ではない... 2026-06-01 は月曜
    const now = new Date(2026, 5, 1, 9, 0, 0).getTime();
    const result = selectReportNudges({
      now,
      runs: [
        run({ id: "w1", origin: "auto-weekly-report" }),
        run({ id: "m1", origin: "auto-monthly-report" }),
      ],
      isSeen,
    });
    expect(result.primary?.kind).toBe("weekly");
    expect(result.secondary?.kind).toBe("monthly");
    expect(result.secondary?.linkLabel).toBe("月次レポート");
  });

  it("既読なら出さない", () => {
    const now = new Date(2026, 8, 21, 9, 0, 0).getTime();
    const result = selectReportNudges({
      now,
      runs: [run({ id: "w1", origin: "auto-weekly-report" })],
      isSeen: () => true,
    });
    expect(result.primary).toBeNull();
  });
});
