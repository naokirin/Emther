import { describe, expect, it, vi } from "vitest";
import { buildTodayStateMeters, elapsedDays, formatElapsedLabel } from "./today-state";
import type { JournalEntry, OrgVitals, PersonSummary } from "@emther/core/types";
import type { NextAction } from "./dashboard-next-actions";

const NOW = new Date(2026, 8, 21, 12, 0, 0).getTime();
const DAY_MS = 24 * 60 * 60 * 1000;

function vitals(overrides: Partial<OrgVitals> = {}): OrgVitals {
  return {
    teams: [
      {
        teamId: "t1",
        teamName: "プラットフォーム",
        status: "bad",
        label: "危険",
        reason: "割り込み増",
        members: ["Aさん"],
        managedByEm: true,
      },
      {
        teamId: "t2",
        teamName: "プロダクト",
        status: "good",
        label: "良い",
        reason: "安定",
        members: ["Bさん"],
        managedByEm: true,
      },
    ],
    oneOnOneCoverage: {
      status: "warn",
      covered: 3,
      total: 5,
      reason: "不足",
      uncoveredMembers: ["Cさん"],
    },
    ...overrides,
  };
}

function person(overrides: Partial<PersonSummary> & { id: string; name: string }): PersonSummary {
  return {
    aliases: [],
    teamNames: [],
    isDirectReport: true,
    isSelf: false,
    factCount: 0,
    trend: { positive: 2, negative: 0, neutral: 1 },
    hasConcerningSuggestion: false,
    ...overrides,
  };
}

describe("buildTodayStateMeters", () => {
  it("EM負荷・健全度・カバレッジ・内訳・4週トーンを返す", () => {
    const nextActions: NextAction[] = [
      {
        id: "a1",
        severity: "urgent",
        lane: "decision",
        icon: "!",
        kindLabel: "判断",
        text: "x",
        onSelect: vi.fn(),
        since: NOW,
      },
      {
        id: "a2",
        severity: "warn",
        lane: "observation",
        icon: "?",
        kindLabel: "観測",
        text: "y",
        onSelect: vi.fn(),
        since: NOW,
      },
    ];
    const journals: JournalEntry[] = [
      {
        id: "j1",
        rawText: "",
        tags: [],
        people: [],
        teamIds: [],
        urgency: "low",
        sentiment: "negative",
        summary: "",
        createdAt: NOW - DAY_MS,
        confirmed: true,
      },
    ];
    const meters = buildTodayStateMeters({
      now: NOW,
      journalEntries: journals,
      vitals: vitals(),
      people: [
        person({ id: "p1", name: "Aさん", trend: { positive: 0, negative: 3, neutral: 0 } }),
        person({ id: "p2", name: "Dさん", trend: { positive: 3, negative: 0, neutral: 0 } }),
      ],
      nextActions,
      decisionQueueLimit: 3,
      observationQueueLimit: 3,
      push: vi.fn(),
      prefillJournal: vi.fn(),
    });

    expect(meters.emLoad).toEqual({ current: 2, max: 7 });
    expect(meters.oneOnOneCoveragePercent).toBe(60);
    expect(meters.teamHealth.total).toBe(2);
    expect(meters.teamHealth.buckets.every((b) => !b.examples.includes("1on1カバレッジ"))).toBe(true);
    expect(meters.personHealth.buckets.some((b) => b.status === "bad")).toBe(true);
    expect(meters.weeklyTone).toHaveLength(4);
    expect(meters.attentionChips.length).toBeGreaterThan(0);
    expect(meters.orgHealthPercent).not.toBeNull();
  });

  it("EM負荷の current はソフト上限でキャップしない", () => {
    const nextActions: NextAction[] = Array.from({ length: 10 }, (_, i) => ({
      id: `a${i}`,
      severity: "warn" as const,
      lane: "decision" as const,
      icon: "!",
      kindLabel: "判断",
      text: `x${i}`,
      onSelect: vi.fn(),
      since: NOW,
    }));
    const meters = buildTodayStateMeters({
      now: NOW,
      journalEntries: [],
      vitals: vitals(),
      people: [],
      nextActions,
      decisionQueueLimit: 3,
      observationQueueLimit: 3,
      push: vi.fn(),
      prefillJournal: vi.fn(),
    });
    expect(meters.emLoad).toEqual({ current: 10, max: 7 });
  });
});

describe("elapsed helpers", () => {
  it("経過日ラベルを返す", () => {
    expect(formatElapsedLabel(NOW, NOW)).toBe("今日");
    expect(formatElapsedLabel(NOW - 5 * DAY_MS, NOW)).toBe("5日");
    expect(elapsedDays(NOW - 5 * DAY_MS, NOW)).toBe(5);
  });
});
