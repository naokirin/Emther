import { describe, expect, it, vi } from "vitest";
import { buildDailySituation } from "./daily-situation";
import type { NextAction } from "./dashboard-next-actions";
import type { JournalEntry, OrgVitals, PersonSummary, Suggestion } from "@emther/core/types";

const DAY_MS = 24 * 60 * 60 * 1000;
// 固定の「今日」。2026-09-13は日曜日。週窓は月曜始まりなので今週=9/7〜9/13、先週=8/31〜9/6。
const NOW = new Date(2026, 8, 13, 12, 0, 0).getTime();
const THIS_WEEK = new Date(2026, 8, 10, 12, 0, 0).getTime(); // 水曜
const LAST_WEEK = new Date(2026, 8, 3, 12, 0, 0).getTime(); // 前週水曜

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
    hasConcerningSuggestion: false,
    ...overrides,
  };
}

function suggestion(overrides: Partial<Suggestion> & { id: string; title: string }): Suggestion {
  return {
    reviewStatus: "unreviewed",
    confirmPriority: "normal",
    memos: [],
    createdAt: NOW - 30 * DAY_MS,
    updatedAt: NOW - 30 * DAY_MS,
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

function build(overrides: Partial<Parameters<typeof buildDailySituation>[0]> = {}) {
  return buildDailySituation({
    now: NOW,
    journalEntries: [],
    vitals: EMPTY_VITALS,
    people: [],
    nextActions: [],
    suggestions: [],
    staleInterventionDays: 14,
    push: noop,
    prefillJournal: noop,
    ...overrides,
  });
}

describe("buildDailySituation", () => {
  it("直近24時間のJournalだけをchangesに入れる", () => {
    const entries = [
      journal({ id: "recent", createdAt: NOW - 1 * 60 * 60 * 1000, summary: "最近の記録" }),
      journal({ id: "old", createdAt: NOW - 2 * DAY_MS, summary: "古い記録" }),
    ];
    const result = build({ journalEntries: entries });
    expect(result.changes.map((i) => i.id)).toEqual(["changes-journal-recent"]);
  });

  it("good/unknownのTeam・Person振り分けは維持し、concernsは個体ではなく集約シグナルにする", () => {
    const vitals: OrgVitals = {
      teams: [
        { teamId: "t-bad", teamName: "Bad Team", status: "bad", label: "要注意", reason: "低調", members: [], managedByEm: true },
        { teamId: "t-warn", teamName: "Warn Team", status: "warn", label: "やや注意", reason: "やや低調", members: [], managedByEm: true },
        { teamId: "t-good", teamName: "Good Team", status: "good", label: "安定", reason: "順調", members: [], managedByEm: true },
        { teamId: "t-unknown", teamName: "Unknown Team", status: "unknown", label: "評価不能", reason: "情報不足", members: [], managedByEm: true },
      ],
      oneOnOneCoverage: { status: "good", covered: 3, total: 3, reason: "", uncoveredMembers: [] },
    };
    const people: PersonSummary[] = [
      person({ id: "p-bad", name: "Aさん", trend: { positive: 0, negative: 3, neutral: 0 } }),
      person({ id: "p-warn", name: "Cさん", trend: { positive: 1, negative: 1, neutral: 0 } }),
      person({ id: "p-good", name: "Bさん", trend: { positive: 3, negative: 0, neutral: 0 } }),
    ];
    const push = vi.fn();
    const result = build({ vitals, people, push });

    expect(result.concerns.map((i) => i.id)).toContain("concern-vitals-teams");
    expect(result.concerns.map((i) => i.id)).toContain("concern-vitals-people");
    expect(result.concerns.some((i) => i.id.startsWith("concern-team-"))).toBe(false);
    expect(result.concerns.some((i) => i.id.startsWith("concern-person-"))).toBe(false);
    expect(result.concerns.find((i) => i.id === "concern-vitals-teams")?.signalKind).toBe("vitals");

    expect(result.good.map((i) => i.id)).toContain("good-team-t-good");
    expect(result.good.map((i) => i.id)).toContain("good-person-p-good");
    expect(result.unevaluable.map((i) => i.id)).toContain("unevaluable-team-t-unknown");

    result.concerns.find((i) => i.id === "concern-vitals-teams")?.onSelect?.();
    expect(push).toHaveBeenCalledWith("/teams?focus=t-bad");
  });

  it("warnチームが1つだけのときは集約シグナルを出さない（注目チップ側）", () => {
    const vitals: OrgVitals = {
      teams: [
        { teamId: "t-warn", teamName: "Warn Team", status: "warn", label: "やや注意", reason: "やや低調", members: [], managedByEm: true },
      ],
      oneOnOneCoverage: { status: "good", covered: 3, total: 3, reason: "", uncoveredMembers: [] },
    };
    const result = build({ vitals });
    expect(result.concerns.map((i) => i.id)).not.toContain("concern-vitals-teams");
  });

  it("自分の管理するチームのメンバー(isDirectReport)でない人物はメンバー集約に出さない", () => {
    const people: PersonSummary[] = [
      person({ id: "p-managed", name: "Aさん", isDirectReport: true, trend: { positive: 0, negative: 3, neutral: 0 } }),
      person({ id: "p-other", name: "Bさん", isDirectReport: false, trend: { positive: 0, negative: 3, neutral: 0 } }),
      person({ id: "p-managed-2", name: "Cさん", isDirectReport: true, trend: { positive: 0, negative: 2, neutral: 0 } }),
    ];
    const result = build({ people });
    const peopleSignal = result.concerns.find((i) => i.id === "concern-vitals-people");
    expect(peopleSignal?.text).toContain("Aさん");
    expect(peopleSignal?.text).toContain("Cさん");
    expect(peopleSignal?.text).not.toContain("Bさん");
  });

  it("緊急Journalはconcernsに入れない", () => {
    const entries = [
      journal({ id: "urgent", createdAt: NOW - DAY_MS, urgency: "high", sentiment: "negative", summary: "緊急の話" }),
    ];
    const result = build({ journalEntries: entries });
    expect(result.concerns.some((i) => i.id.startsWith("concern-journal-"))).toBe(false);
  });

  it("Journal総件数が同期間比で半減したら観測量シグナルを出す", () => {
    const entries = [
      journal({ id: "l1", createdAt: LAST_WEEK }),
      journal({ id: "l2", createdAt: LAST_WEEK + 1000 }),
      journal({ id: "l3", createdAt: LAST_WEEK + 2000 }),
      journal({ id: "l4", createdAt: LAST_WEEK + 3000 }),
      journal({ id: "t1", createdAt: THIS_WEEK }),
      journal({ id: "t2", createdAt: THIS_WEEK + 1000 }),
    ];
    const push = vi.fn();
    const result = build({ journalEntries: entries, push });
    const volume = result.concerns.find((i) => i.id === "concern-journal-volume");
    expect(volume?.signalKind).toBe("journal-volume");
    expect(volume?.text).toContain("先週同期間");
    volume?.onSelect?.();
    expect(push).toHaveBeenCalledWith("/journal");
  });

  it("週初で先週全体より少なくても、同期間比が落ちていなければ観測量シグナルを出さない", () => {
    // 火曜正午（経過約1.5日 < 2日）→ まだ比較しない。
    // 加えて、経過2日超でも「先週後半に溜まった件数」と今週序盤を比べないことを
    // 水曜時点のケースで担保する。
    const mondayNoon = new Date(2026, 8, 7, 12, 0, 0).getTime(); // 今週月曜
    const earlyResult = build({
      now: mondayNoon,
      journalEntries: [
        // 先週は後半（木〜）に多く、月曜午前相当には少ない
        journal({ id: "l-late-1", createdAt: new Date(2026, 8, 3, 12, 0, 0).getTime() }),
        journal({ id: "l-late-2", createdAt: new Date(2026, 8, 4, 12, 0, 0).getTime() }),
        journal({ id: "l-late-3", createdAt: new Date(2026, 8, 5, 12, 0, 0).getTime() }),
        journal({ id: "l-late-4", createdAt: new Date(2026, 8, 6, 12, 0, 0).getTime() }),
        journal({ id: "t1", createdAt: mondayNoon - 1000 }),
      ],
    });
    expect(earlyResult.concerns.map((i) => i.id)).not.toContain("concern-journal-volume");

    // 水曜正午: 先週同期間（月〜水）は0件、今週は1件 → 半減判定にならない
    const wednesdayNoon = new Date(2026, 8, 9, 12, 0, 0).getTime();
    const midResult = build({
      now: wednesdayNoon,
      journalEntries: [
        journal({ id: "l-late-1", createdAt: new Date(2026, 8, 3, 12, 0, 0).getTime() }),
        journal({ id: "l-late-2", createdAt: new Date(2026, 8, 4, 12, 0, 0).getTime() }),
        journal({ id: "l-late-3", createdAt: new Date(2026, 8, 5, 12, 0, 0).getTime() }),
        journal({ id: "l-late-4", createdAt: new Date(2026, 8, 6, 12, 0, 0).getTime() }),
        journal({ id: "t1", createdAt: new Date(2026, 8, 8, 12, 0, 0).getTime() }),
      ],
    });
    expect(midResult.concerns.map((i) => i.id)).not.toContain("concern-journal-volume");
  });

  it("今週のネガが先週同期間より増えたら傾向シグナルを出す", () => {
    const entries = [
      journal({ id: "ln1", createdAt: LAST_WEEK, sentiment: "negative" }),
      journal({ id: "tn1", createdAt: THIS_WEEK, sentiment: "negative" }),
      journal({ id: "tn2", createdAt: THIS_WEEK + 1000, sentiment: "negative" }),
      journal({ id: "tn3", createdAt: THIS_WEEK + 2000, sentiment: "negative" }),
    ];
    const result = build({ journalEntries: entries });
    expect(result.concerns.map((i) => i.id)).toContain("concern-tone-worsening");
    expect(result.concerns.find((i) => i.id === "concern-tone-worsening")?.text).toContain("先週同期間");
  });

  it("同一チームにネガ傾向メンバーが複数なら横断シグナルを出す", () => {
    const people: PersonSummary[] = [
      person({
        id: "p1",
        name: "Aさん",
        teamNames: ["Platform"],
        trend: { positive: 0, negative: 2, neutral: 0 },
      }),
      person({
        id: "p2",
        name: "Bさん",
        teamNames: ["Platform"],
        trend: { positive: 0, negative: 2, neutral: 0 },
      }),
    ];
    const result = build({ people });
    expect(result.concerns.some((i) => i.id.startsWith("concern-spread-team-"))).toBe(true);
    expect(result.concerns.find((i) => i.signalKind === "spread")?.text).toContain("Platform");
  });

  it("停滞提案が2件以上なら未処理課題シグナルを出す", () => {
    const suggestions = [
      suggestion({ id: "s1", title: "提案A", updatedAt: NOW - 20 * DAY_MS }),
      suggestion({ id: "s2", title: "提案B", updatedAt: NOW - 21 * DAY_MS }),
      suggestion({ id: "s3", title: "新しい", updatedAt: NOW - DAY_MS }),
    ];
    const push = vi.fn();
    const result = build({ suggestions, staleInterventionDays: 14, push });
    expect(result.concerns.map((i) => i.id)).toContain("concern-stalled-suggestions");
    expect(result.concerns.find((i) => i.id === "concern-stalled-suggestions")?.text).toContain("2件");
    result.concerns.find((i) => i.id === "concern-stalled-suggestions")?.onSelect?.();
    expect(push).toHaveBeenCalledWith("/suggestions");
  });

  // ユーザー指摘「過去との比較に長期プロファイルが混ざってくる」対応。長期プロファイル
  // （KnowledgeEvent kind:interpretation）はTTLの無い恒常的な人物解釈であり、「今週→先週で
  // 何が変わったか」という比較の趣旨とは性質が異なるため、comparisonsには混ぜない。
  it("comparisonsには今週/先週のJournal傾向比較のみを入れ、長期プロファイルは混ぜない", () => {
    const entries = [
      journal({ id: "j1", createdAt: NOW - 2 * DAY_MS, sentiment: "negative" }),
      journal({ id: "j2", createdAt: NOW - 9 * DAY_MS, sentiment: "positive" }),
    ];
    const result = build({ journalEntries: entries });
    expect(result.comparisons.map((i) => i.id)).toEqual(["comparison-journal-trend"]);
    expect(result.comparisons.some((i) => i.id.startsWith("comparison-interpretation-"))).toBe(false);
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
    const result = build({ nextActions: actions });
    expect(result.worthDeciding).toHaveLength(5);
    expect(result.worthDecidingOverflow).toBe(1);
    expect(result.worthDeciding.every((i) => i.id.startsWith("worth-a"))).toBe(true);
  });

  it("1on1 Coverageはgoodならgoodへ、bad/warnならunevaluableへ振り分ける（旧TeamStatePanel廃止に伴う統合）", () => {
    const goodResult = build({
      vitals: { teams: [], oneOnOneCoverage: { status: "good", covered: 5, total: 5, reason: "", uncoveredMembers: [] } },
    });
    expect(goodResult.good.map((i) => i.id)).toContain("good-coverage");
    expect(goodResult.unevaluable.map((i) => i.id)).not.toContain("unevaluable-coverage");

    const prefillJournal = vi.fn();
    const warnResult = build({
      vitals: {
        teams: [],
        oneOnOneCoverage: { status: "warn", covered: 2, total: 7, reason: "", uncoveredMembers: ["Aさん", "Bさん"] },
      },
      prefillJournal,
    });
    expect(warnResult.unevaluable.map((i) => i.id)).toContain("unevaluable-coverage");
    expect(warnResult.good.map((i) => i.id)).not.toContain("good-coverage");

    const coverageItem = warnResult.unevaluable.find((i) => i.id === "unevaluable-coverage");
    expect(coverageItem?.detail).toContain("Aさん、Bさん");
    coverageItem?.onSelect?.();
    expect(prefillJournal).toHaveBeenCalledWith("#1on1 @Aさん ");
  });

  it("onSelectを呼ぶとpushへ正しいパスが渡る", () => {
    const push = vi.fn();
    const entries = [journal({ id: "j1", createdAt: NOW - 1000, summary: "記録" })];
    const result = build({ journalEntries: entries, push });
    result.changes[0].onSelect?.();
    expect(push).toHaveBeenCalledWith("/journal?focus=j1");
  });
});
