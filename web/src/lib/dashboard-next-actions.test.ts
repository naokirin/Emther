import { describe, expect, it } from "vitest";
import { buildNextActions, type BuildNextActionsParams } from "@/lib/dashboard-next-actions";
import type { Issue, JournalEntry, OrgVitals, PersonSummary } from "@/lib/types";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date(2026, 8, 13, 12, 0, 0).getTime();

function issue(overrides: Partial<Issue> & { id: string }): Issue {
  return {
    title: "テスト提案",
    charter: { why: "", what: "", how: "" },
    actionItems: [],
    logEntries: [],
    status: "in_progress",
    reviewStatus: "unreviewed",
    priority: "normal",
    archived: false,
    tags: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

const EMPTY_VITALS: OrgVitals = {
  teams: [],
  oneOnOneCoverage: { status: "good", covered: 3, total: 3, reason: "", uncoveredMembers: [] },
};

function person(overrides: Partial<PersonSummary> & { id: string; name: string }): PersonSummary {
  return {
    aliases: [],
    teamNames: [],
    trend: { positive: 0, negative: 0, neutral: 0 },
    factCount: 0,
    isDirectReport: true,
    isSelf: false,
    hasConcerningIssue: false,
    ...overrides,
  };
}

function journal(overrides: Partial<JournalEntry> & { id: string }): JournalEntry {
  return {
    rawText: "raw",
    tags: [],
    people: [],
    teamIds: [],
    urgency: "low",
    sentiment: "neutral",
    summary: "",
    createdAt: NOW,
    confirmed: true,
    ...overrides,
  };
}

const noop = () => {};

function baseParams(overrides: Partial<BuildNextActionsParams> = {}): BuildNextActionsParams {
  return {
    now: NOW,
    runs: [],
    issues: [],
    journalEntries: [],
    people: [],
    vitals: EMPTY_VITALS,
    pendingAgentStarts: [],
    pendingUnmaskedSends: [],
    staleRunIds: new Set(),
    watchingItems: [],
    goToRunIssue: noop,
    push: noop,
    prefillJournal: noop,
    onConfirmUnmasked: noop,
    ...overrides,
  };
}

describe("buildNextActions の要注目人物（観測不足レーン）", () => {
  it("自分の管理するチームのメンバー(isDirectReport)だけを要注目人物として観測不足レーンに載せる", () => {
    const people: PersonSummary[] = [
      person({ id: "p-managed", name: "Aさん", isDirectReport: true, trend: { positive: 0, negative: 3, neutral: 0 } }),
      person({ id: "p-other", name: "Bさん", isDirectReport: false, trend: { positive: 0, negative: 3, neutral: 0 } }),
    ];
    const actions = buildNextActions(baseParams({ people }));
    const ids = actions.map((a) => a.id);
    expect(ids).toContain("person-p-managed");
    expect(ids).not.toContain("person-p-other");
  });

  it("要注目人物のカードはobservationレーンに入る", () => {
    const people: PersonSummary[] = [
      person({ id: "p-managed", name: "Aさん", isDirectReport: true, trend: { positive: 0, negative: 3, neutral: 0 } }),
    ];
    const actions = buildNextActions(baseParams({ people }));
    const card = actions.find((a) => a.id === "person-p-managed");
    expect(card?.lane).toBe("observation");
  });
});

// ユーザー要望「期日超過の提案を朝キューにも自動で出してほしい」対応。
describe("buildNextActions の確認期日超過（判断待ちレーン）", () => {
  it("reviewDueAtを過ぎている提案を判断待ちレーンへ出す", () => {
    const issues: Issue[] = [
      issue({ id: "i-overdue", title: "期日超過の提案", reviewDueAt: NOW - 2 * DAY_MS }),
    ];
    const actions = buildNextActions(baseParams({ issues }));
    const card = actions.find((a) => a.id === "review-due-i-overdue");
    expect(card).toBeDefined();
    expect(card?.lane).toBe("decision");
    expect(card?.text).toContain("期日超過の提案");
    expect(card?.text).toContain("2日前");
  });

  it("reviewDueAtが未来、または未設定なら出さない", () => {
    const issues: Issue[] = [
      issue({ id: "i-future", reviewDueAt: NOW + DAY_MS }),
      issue({ id: "i-none" }),
    ];
    const actions = buildNextActions(baseParams({ issues }));
    expect(actions.some((a) => a.id.startsWith("review-due-"))).toBe(false);
  });

  it("確認済み(done)またはアーカイブ済みの提案は期日を過ぎていても出さない", () => {
    const issues: Issue[] = [
      issue({ id: "i-done", reviewDueAt: NOW - DAY_MS, status: "done", reviewStatus: "done", archived: true }),
    ];
    const actions = buildNextActions(baseParams({ issues }));
    expect(actions.some((a) => a.id.startsWith("review-due-"))).toBe(false);
  });
});

// ユーザー指摘「確認済み（対応不要）にしたJournalはメンバーのアラート換算から外したい」対応。
describe("buildNextActions のJournalカードとnoActionNeededAt除外", () => {
  it("確認済み（対応不要）にしたJournalは「要注目Journal」に出さない", () => {
    const journalEntries: JournalEntry[] = [
      journal({
        id: "j-noaction",
        urgency: "mid",
        sentiment: "negative",
        noActionNeededAt: NOW - 1000,
      }),
    ];
    const actions = buildNextActions(baseParams({ journalEntries }));
    expect(actions.some((a) => a.id === "journal-j-noaction")).toBe(false);
  });

  it("確認済み（対応不要）にしたJournalは「Journal未確認」に出さない", () => {
    const journalEntries: JournalEntry[] = [
      journal({
        id: "j-noaction-high",
        urgency: "high",
        confirmed: false,
        noActionNeededAt: NOW - 1000,
      }),
    ];
    const actions = buildNextActions(baseParams({ journalEntries }));
    expect(actions.some((a) => a.id === "journal-unconfirmed-j-noaction-high")).toBe(false);
  });
});
