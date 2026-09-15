import { describe, expect, it, vi } from "vitest";
import { buildDailySituation, type InterpretationEvent } from "@/lib/daily-situation";
import type { NextAction } from "@/lib/dashboard-next-actions";
import type { JournalEntry, OrgVitals, PersonSummary } from "@/lib/types";

const DAY_MS = 24 * 60 * 60 * 1000;
// 固定の「今日」。2026-09-13は日曜日。
const NOW = new Date(2026, 8, 13, 12, 0, 0).getTime();

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

const EMPTY_VITALS: OrgVitals = {
  teams: [],
  oneOnOneCoverage: { status: "good", covered: 3, total: 3, reason: "", uncoveredMembers: [] },
};

function nextAction(overrides: Partial<NextAction> & { id: string }): NextAction {
  return {
    severity: "urgent",
    lane: "decision",
    icon: "🔴",
    kindLabel: "テスト",
    text: "テスト項目",
    onSelect: () => {},
    since: NOW,
    ...overrides,
  };
}

const noop = () => {};

describe("buildDailySituation", () => {
  it("直近24時間のJournalだけをchangesに入れる", () => {
    const entries = [
      journal({ id: "recent", createdAt: NOW - 1 * 60 * 60 * 1000, summary: "最近の記録" }),
      journal({ id: "old", createdAt: NOW - 2 * DAY_MS, summary: "古い記録" }),
    ];
    const result = buildDailySituation({
      now: NOW,
      journalEntries: entries,
      vitals: EMPTY_VITALS,
      people: [],
      interpretations: [],
      nextActions: [],
      push: noop,
    });
    expect(result.changes.map((i) => i.id)).toEqual(["changes-journal-recent"]);
  });

  it("bad/warnのTeam・Personをconcernsへgoodはgoodへunknownはunevaluableへ振り分け、statusとチーム個別リンクを持つ", () => {
    const vitals: OrgVitals = {
      teams: [
        { teamId: "t-bad", teamName: "Bad Team", status: "bad", label: "要注意", reason: "低調", members: [], managedByEm: true },
        { teamId: "t-good", teamName: "Good Team", status: "good", label: "安定", reason: "順調", members: [], managedByEm: true },
        { teamId: "t-unknown", teamName: "Unknown Team", status: "unknown", label: "評価不能", reason: "情報不足", members: [], managedByEm: true },
      ],
      oneOnOneCoverage: { status: "good", covered: 3, total: 3, reason: "", uncoveredMembers: [] },
    };
    const people: PersonSummary[] = [
      person({ id: "p-bad", name: "Aさん", trend: { positive: 0, negative: 3, neutral: 0 } }),
      person({ id: "p-good", name: "Bさん", trend: { positive: 3, negative: 0, neutral: 0 } }),
    ];
    const push = vi.fn();
    const result = buildDailySituation({
      now: NOW,
      journalEntries: [],
      vitals,
      people,
      interpretations: [],
      nextActions: [],
      push,
    });
    expect(result.concerns.map((i) => i.id)).toContain("concern-team-t-bad");
    expect(result.concerns.map((i) => i.id)).toContain("concern-person-p-bad");
    expect(result.good.map((i) => i.id)).toContain("good-team-t-good");
    expect(result.good.map((i) => i.id)).toContain("good-person-p-good");
    expect(result.unevaluable.map((i) => i.id)).toContain("unevaluable-team-t-unknown");

    // 状態チップに使うstatusが、対応するVitalsのstatusと一致している。
    expect(result.concerns.find((i) => i.id === "concern-team-t-bad")?.status).toBe("bad");
    expect(result.concerns.find((i) => i.id === "concern-person-p-bad")?.status).toBe("bad");
    expect(result.good.find((i) => i.id === "good-team-t-good")?.status).toBe("good");
    expect(result.unevaluable.find((i) => i.id === "unevaluable-team-t-unknown")?.status).toBe("unknown");

    // ユーザー指摘「リンク先とチップのテキストが違う」対応: チームはそのチームへフォーカス
    // して開く（/teams?focus=）。テキストの対象とリンク先が一致すること。
    result.concerns.find((i) => i.id === "concern-team-t-bad")?.onSelect?.();
    expect(push).toHaveBeenCalledWith("/teams?focus=t-bad");

    // ユーザー指摘「チーム・メンバーが混合で並んでいる」対応: entityKindでチーム／
    // メンバーを判別できる。textは名前だけ、詳細はdetailへ逃がしている。
    expect(result.concerns.find((i) => i.id === "concern-team-t-bad")?.entityKind).toBe("team");
    expect(result.concerns.find((i) => i.id === "concern-person-p-bad")?.entityKind).toBe("person");
    expect(result.concerns.find((i) => i.id === "concern-team-t-bad")?.text).toBe("Bad Team");
    expect(result.concerns.find((i) => i.id === "concern-team-t-bad")?.detail).toContain("Bad Team");
  });

  it("緊急度high・ネガティブで未解決のJournalをconcernsに入れるが、statusは付けずチームチップに混ぜない", () => {
    const entries = [
      journal({ id: "urgent", createdAt: NOW - DAY_MS, urgency: "high", sentiment: "negative", summary: "緊急の話" }),
      journal({
        id: "resolved",
        createdAt: NOW - DAY_MS,
        urgency: "high",
        sentiment: "negative",
        summary: "対応済み",
        resolutionNote: "対応済み",
      }),
    ];
    const result = buildDailySituation({
      now: NOW,
      journalEntries: entries,
      vitals: EMPTY_VITALS,
      people: [],
      interpretations: [],
      nextActions: [],
      push: noop,
    });
    expect(result.concerns.map((i) => i.id)).toEqual(["concern-journal-urgent"]);
    expect(result.concerns[0].status).toBeUndefined();
  });

  it("すでにLead Agent runが紐づく（sourceConsultRunIdあり）Journalはconcernsに入れない", () => {
    const entries = [
      journal({
        id: "already-run",
        createdAt: NOW - DAY_MS,
        urgency: "high",
        sentiment: "negative",
        summary: "すでに相談中",
        sourceConsultRunId: "run-1",
      }),
    ];
    const result = buildDailySituation({
      now: NOW,
      journalEntries: entries,
      vitals: EMPTY_VITALS,
      people: [],
      interpretations: [],
      nextActions: [],
      push: noop,
    });
    expect(result.concerns.map((i) => i.id)).toEqual([]);
  });

  it("気になる人物に関する解釈だけをcomparisonsに含める", () => {
    const people: PersonSummary[] = [person({ id: "p-bad", name: "Aさん", trend: { positive: 0, negative: 3, neutral: 0 } })];
    const interpretations: InterpretationEvent[] = [
      { id: "i-1", text: "Aさんはリーダー志向がある", tags: [], people: ["Aさん"], occurredAt: NOW - 30 * DAY_MS },
      { id: "i-2", text: "Cさんは新任", tags: [], people: ["Cさん"], occurredAt: NOW - 30 * DAY_MS },
    ];
    const result = buildDailySituation({
      now: NOW,
      journalEntries: [],
      vitals: EMPTY_VITALS,
      people,
      interpretations,
      nextActions: [],
      push: noop,
    });
    const ids = result.comparisons.map((i) => i.id);
    expect(ids).toContain("comparison-interpretation-i-1");
    expect(ids).not.toContain("comparison-interpretation-i-2");
  });

  it("worthDecidingはdecisionレーンのみを反映し、上限超過分をoverflowで返す", () => {
    const actions = [
      nextAction({ id: "a1" }),
      nextAction({ id: "a2" }),
      nextAction({ id: "a3" }),
      nextAction({ id: "a4" }),
      nextAction({ id: "a5" }),
      nextAction({ id: "a6" }),
      nextAction({ id: "obs-1", lane: "observation" }),
    ];
    const result = buildDailySituation({
      now: NOW,
      journalEntries: [],
      vitals: EMPTY_VITALS,
      people: [],
      interpretations: [],
      nextActions: actions,
      push: noop,
    });
    expect(result.worthDeciding).toHaveLength(5);
    expect(result.worthDecidingOverflow).toBe(1);
    expect(result.worthDeciding.every((i) => i.id.startsWith("worth-a"))).toBe(true);
  });

  it("onSelectを呼ぶとpushへ正しいパスが渡る", () => {
    const push = vi.fn();
    const entries = [journal({ id: "j1", createdAt: NOW - 1000, summary: "記録" })];
    const result = buildDailySituation({
      now: NOW,
      journalEntries: entries,
      vitals: EMPTY_VITALS,
      people: [],
      interpretations: [],
      nextActions: [],
      push,
    });
    result.changes[0].onSelect?.();
    expect(push).toHaveBeenCalledWith("/journal?focus=j1");
  });
});
