import { describe, expect, it } from "vitest";
import {
  isSuggestionDeferredFromDaily,
  listDailyRelevantOpenSuggestions,
  listRecentBatchConclusions,
  listWeeklyAwarenessSuggestions,
  SIMILAR_THEME_COOLDOWN_MS,
} from "./suggestion-cadence";
import type { AgentRun } from "./types";
import type { Suggestion } from "../types";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date(2026, 8, 22, 12, 0, 0).getTime();

function suggestion(overrides: Partial<Suggestion> & { id: string }): Suggestion {
  return {
    title: "t",
    reviewStatus: "unreviewed",
    confirmPriority: "normal",
    memos: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function run(overrides: Partial<AgentRun> & { id: string }): AgentRun {
  return {
    id: overrides.id,
    agentName: "Lead Agent",
    task: "task",
    status: "idle",
    log: [],
    totalCostUsd: 0,
    createdAt: NOW,
    updatedAt: NOW,
    origin: "auto-summary",
    reviewed: false,
    ...overrides,
  };
}

describe("suggestion-cadence", () => {
  it("SIMILAR_THEME_COOLDOWN_MS は約7日（昨日だけにしない）", () => {
    expect(SIMILAR_THEME_COOLDOWN_MS).toBe(7 * DAY_MS);
  });

  it("listRecentBatchConclusions はクールダウン窓内のバッチ結論だけ返す", () => {
    const recent = listRecentBatchConclusions(
      [
        run({
          id: "r-new",
          createdAt: NOW - 2 * DAY_MS,
          proposal: { conclusion: "新しい結論", facts: [], logic: "", recommendation: "suggestion" },
        }),
        run({
          id: "r-old",
          createdAt: NOW - 10 * DAY_MS,
          proposal: { conclusion: "古い結論", facts: [], logic: "", recommendation: "suggestion" },
        }),
        run({
          id: "r-manual",
          origin: "manual",
          createdAt: NOW - DAY_MS,
          proposal: { conclusion: "手動", facts: [], logic: "", recommendation: "suggestion" },
        }),
      ],
      NOW,
    );
    expect(recent.map((r) => r.runId)).toEqual(["r-new"]);
    expect(recent[0].text).toContain("新しい結論");
  });

  it("延期系は日次関連から外れ、週次気づきに入る", () => {
    const suggestions = [
      suggestion({ id: "s-open", title: "今日見る" }),
      suggestion({ id: "s-parked", title: "後で", confirmPriority: "parked" }),
      suggestion({ id: "s-deferred", title: "保留", reviewStatus: "deferred" }),
      suggestion({ id: "s-future", title: "期日前", reviewDueAt: NOW + 3 * DAY_MS }),
    ];
    expect(isSuggestionDeferredFromDaily(suggestions[1], NOW)).toBe(true);
    expect(listDailyRelevantOpenSuggestions(suggestions, NOW, 10).map((s) => s.id)).toEqual(["s-open"]);
    expect(listWeeklyAwarenessSuggestions(suggestions, NOW, 10).map((s) => s.id).sort()).toEqual([
      "s-deferred",
      "s-future",
      "s-parked",
    ]);
  });
});
