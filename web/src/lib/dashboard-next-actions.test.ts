import { describe, expect, it } from "vitest";
import { buildNextActions, type BuildNextActionsParams } from "@/lib/dashboard-next-actions";
import type { OrgVitals, PersonSummary } from "@/lib/types";

const NOW = new Date(2026, 8, 13, 12, 0, 0).getTime();

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
