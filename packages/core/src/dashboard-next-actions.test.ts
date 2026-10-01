import { describe, expect, it } from "vitest";
import {
  buildNextActions,
  heroRank,
  isSuggestionDeferredFromDailyQueue,
  selectWatchingItems,
  type BuildNextActionsParams,
  type NextAction,
} from "./dashboard-next-actions";
import type { AgentRun } from "./agent-runtime/types";
import type { JournalEntry, OrgVitals, PersonSummary, Suggestion } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date(2026, 8, 13, 12, 0, 0).getTime();

function suggestion(overrides: Partial<Suggestion> & { id: string }): Suggestion {
  return {
    title: "テスト提案",
    reviewStatus: "unreviewed",
    confirmPriority: "normal",
    memos: [],
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
    hasConcerningSuggestion: false,
    archived: false,
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

function run(overrides: Partial<AgentRun> & { id: string }): AgentRun {
  return {
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

function proposal(conclusion: string) {
  return {
    conclusion,
    facts: [] as string[],
    logic: "",
    rejectedAlternatives: [] as { option: string; reason: string }[],
    expansions: [] as string[],
    challenges: [] as string[],
    explorations: [],
    recommendation: "suggestion" as const,
  };
}

const noopTarget = { type: "path" as const, path: "/" };

function baseParams(overrides: Partial<BuildNextActionsParams> = {}): BuildNextActionsParams {
  return {
    now: NOW,
    runs: [],
    suggestions: [],
    journalEntries: [],
    people: [],
    vitals: EMPTY_VITALS,
    pendingAgentStarts: [],
    pendingUnmaskedSends: [],
    staleRunIds: new Set(),
    watchingItems: [],
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

describe("buildNextActions のAI自動作成提案（判断待ちレーン）", () => {
  it("未確認の自動作成提案を「残す／不要」の判断カードとして出す（手動作成・確認済み・アーカイブは出さない）", () => {
    const suggestions: Suggestion[] = [
      suggestion({ id: "s-auto", title: "自動で作られた提案", autoCreated: true }),
      suggestion({ id: "s-manual" }),
      suggestion({ id: "s-auto-kept", autoCreated: true, reviewStatus: "in_review" }),
      suggestion({ id: "s-auto-archived", autoCreated: true, archivedAt: NOW }),
    ];
    const actions = buildNextActions(baseParams({ suggestions }));
    const cards = actions.filter((a) => a.id.startsWith("ai-suggestion-"));
    expect(cards.map((a) => a.id)).toEqual(["ai-suggestion-s-auto"]);
    expect(cards[0].lane).toBe("decision");
    expect(cards[0].text).toContain("自動で作られた提案");
    expect(cards[0].target).toEqual({ type: "path", path: "/suggestions/s-auto" });
    expect(heroRank(cards[0])).toBe(3);
  });

  it("3件以上たまったら提案一覧（AI自動作成・未確認の絞り込み）への1枚に束ねる", () => {
    const suggestions: Suggestion[] = ["a", "b", "c"].map((id) => suggestion({ id, autoCreated: true }));
    const actions = buildNextActions(baseParams({ suggestions }));
    const cards = actions.filter((a) => a.id.startsWith("ai-suggestion-"));
    expect(cards).toHaveLength(1);
    expect(cards[0].target).toEqual({ type: "path", path: "/suggestions?auto=1" });
    expect(cards[0].text).toContain("3件");
  });

  it("未確認の自動作成提案は停滞カードとは二重に出さない", () => {
    const suggestions: Suggestion[] = [
      suggestion({ id: "s-auto-old", autoCreated: true, createdAt: NOW - 30 * DAY_MS, updatedAt: NOW - 30 * DAY_MS }),
    ];
    const actions = buildNextActions(baseParams({ suggestions }));
    expect(actions.some((a) => a.id === "stale-suggestion-s-auto-old")).toBe(false);
    expect(actions.some((a) => a.id === "ai-suggestion-s-auto-old")).toBe(true);
  });
});

describe("buildNextActions の確認期日超過（判断待ちレーン）", () => {
  it("reviewDueAtを過ぎている提案を判断待ちレーンへ出す", () => {
    const suggestions: Suggestion[] = [
      suggestion({ id: "s-overdue", title: "期日超過の提案", reviewDueAt: NOW - 2 * DAY_MS }),
    ];
    const actions = buildNextActions(baseParams({ suggestions }));
    const card = actions.find((a) => a.id === "review-due-s-overdue");
    expect(card).toBeDefined();
    expect(card?.lane).toBe("decision");
    expect(card?.text).toContain("期日超過の提案");
    expect(card?.text).toContain("2日前");
  });

  it("reviewDueAtが未来、または未設定なら出さない", () => {
    const suggestions: Suggestion[] = [
      suggestion({ id: "s-future", reviewDueAt: NOW + DAY_MS }),
      suggestion({ id: "s-none" }),
    ];
    const actions = buildNextActions(baseParams({ suggestions }));
    expect(actions.some((a) => a.id.startsWith("review-due-"))).toBe(false);
  });

  it("アーカイブ済みの提案は期日を過ぎていても出さない", () => {
    const suggestions: Suggestion[] = [
      suggestion({ id: "s-archived", reviewDueAt: NOW - DAY_MS, archivedAt: NOW - DAY_MS }),
    ];
    const actions = buildNextActions(baseParams({ suggestions }));
    expect(actions.some((a) => a.id.startsWith("review-due-"))).toBe(false);
  });

  it("確認済み(done)の提案はアーカイブしていなくても期日超過として出さない", () => {
    const suggestions: Suggestion[] = [
      suggestion({ id: "s-done", title: "確認済みの提案", reviewDueAt: NOW - DAY_MS, reviewStatus: "done" }),
    ];
    const actions = buildNextActions(baseParams({ suggestions }));
    expect(actions.some((a) => a.id.startsWith("review-due-"))).toBe(false);
  });
});

// 日次負荷軽減: parked/deferred/期日前は「提案の停滞」として毎日煽らない。
describe("buildNextActions の意図的延期の除外", () => {
  it("isSuggestionDeferredFromDailyQueue は parked / deferred / 期日前を true にする", () => {
    expect(isSuggestionDeferredFromDailyQueue(suggestion({ id: "a", confirmPriority: "parked" }), NOW)).toBe(true);
    expect(isSuggestionDeferredFromDailyQueue(suggestion({ id: "b", reviewStatus: "deferred" }), NOW)).toBe(true);
    expect(
      isSuggestionDeferredFromDailyQueue(suggestion({ id: "c", reviewDueAt: NOW + DAY_MS }), NOW),
    ).toBe(true);
    expect(isSuggestionDeferredFromDailyQueue(suggestion({ id: "d" }), NOW)).toBe(false);
  });

  it("parked / deferred / 期日前の提案は停滞カードに出さない", () => {
    const suggestions: Suggestion[] = [
      suggestion({ id: "s-parked", title: "後で", confirmPriority: "parked", updatedAt: NOW - 20 * DAY_MS }),
      suggestion({ id: "s-deferred", title: "保留", reviewStatus: "deferred", updatedAt: NOW - 20 * DAY_MS }),
      suggestion({
        id: "s-scheduled",
        title: "期日前",
        reviewDueAt: NOW + 3 * DAY_MS,
        updatedAt: NOW - 20 * DAY_MS,
      }),
      suggestion({ id: "s-stale", title: "動いてない通常", updatedAt: NOW - 20 * DAY_MS }),
    ];
    const actions = buildNextActions(baseParams({ suggestions }));
    const staleIds = actions.filter((a) => a.id.startsWith("stale-suggestion-")).map((a) => a.id);
    expect(staleIds).toEqual(["stale-suggestion-s-stale"]);
  });

  it("parkedでも確認期日超過なら判断待ちに出す", () => {
    const suggestions: Suggestion[] = [
      suggestion({
        id: "s-parked-overdue",
        title: "後回しだが期日超過",
        confirmPriority: "parked",
        reviewDueAt: NOW - DAY_MS,
      }),
    ];
    const actions = buildNextActions(baseParams({ suggestions }));
    expect(actions.some((a) => a.id === "review-due-s-parked-overdue")).toBe(true);
  });
});

describe("buildNextActions の様子見次確認日", () => {
  it("triageNextReviewAtが未来なら様子見期限切れに出さない", () => {
    const watching = run({
      id: "w1",
      origin: "manual",
      reviewed: true,
      triageStatus: "watching",
      triageAt: NOW - 20 * DAY_MS,
      triageNextReviewAt: NOW + 3 * DAY_MS,
    });
    const actions = buildNextActions(baseParams({ watchingItems: [watching] }));
    expect(actions.some((a) => a.id === "watch-expired-w1")).toBe(false);
  });

  it("triageNextReviewAtを過ぎていれば様子見期限切れに出す", () => {
    const watching = run({
      id: "w2",
      origin: "manual",
      reviewed: true,
      triageStatus: "watching",
      triageAt: NOW - 20 * DAY_MS,
      triageNextReviewAt: NOW - DAY_MS,
    });
    const actions = buildNextActions(baseParams({ watchingItems: [watching] }));
    expect(actions.some((a) => a.id === "watch-expired-w2")).toBe(true);
  });
});

describe("selectWatchingItems", () => {
  it("sourceRunIdで提案化済みの様子見は一覧から外す", () => {
    const watching = run({
      id: "w-promoted",
      origin: "manual",
      reviewed: true,
      triageStatus: "watching",
      triageAt: NOW - DAY_MS,
    });
    const stillWatching = run({
      id: "w-open",
      origin: "manual",
      reviewed: true,
      triageStatus: "watching",
      triageAt: NOW - DAY_MS,
    });
    const items = selectWatchingItems(
      [watching, stillWatching],
      [suggestion({ id: "s1", sourceRunId: "w-promoted" })],
    );
    expect(items.map((r) => r.id)).toEqual(["w-open"]);
  });
});

describe("buildNextActions のバッチ系ドラフト束ねと優先度", () => {
  it("定期バッチ由来の起票待ちが2件以上なら束ねる", () => {
    const runs: AgentRun[] = [
      run({
        id: "r1",
        origin: "auto-summary",
        proposal: proposal("A"),
      }),
      run({
        id: "r2",
        origin: "auto-journal-batch",
        proposal: proposal("B"),
      }),
    ];
    const actions = buildNextActions(baseParams({ runs }));
    expect(actions.some((a) => a.id === "auto-bundle")).toBe(true);
    expect(actions.some((a) => a.id === "auto-r1")).toBe(false);
    expect(actions.some((a) => a.id === "auto-r2")).toBe(false);
  });

  it("Yieldはバッチ系ドラフトより heroRank が先", () => {
    const draft: NextAction = {
      id: "auto-x",
      severity: "warn",
      lane: "decision",
      icon: "🤖",
      kindLabel: "ドラフト提案",
      text: "draft",
      target: noopTarget,
      since: NOW,
    };
    const yieldAction: NextAction = {
      id: "yield-y",
      severity: "urgent",
      lane: "decision",
      icon: "🟡",
      kindLabel: "Yield",
      text: "yield",
      target: noopTarget,
      since: NOW,
    };
    expect(heroRank(yieldAction)).toBeLessThan(heroRank(draft));
  });
});

describe("buildNextActions のJournalカードとnoActionNeededAt除外", () => {
  it("mid＋ネガティブのJournalは要注目カードとして出さない", () => {
    const journalEntries: JournalEntry[] = [
      journal({ id: "j-warn", urgency: "mid", sentiment: "negative" }),
    ];
    const actions = buildNextActions(baseParams({ journalEntries }));
    expect(actions.some((a) => a.id === "journal-j-warn" || a.kindLabel === "要注目Journal")).toBe(false);
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

describe("buildNextActions の確認済み提案に紐づく run", () => {
  it("確認済み(done)の提案に紐づくドラフト提案は朝キューに出さない", () => {
    const draft = run({
      id: "run-draft-done",
      origin: "auto-summary",
      reviewed: false,
      status: "idle",
      proposal: proposal("確認済みに紐づく結論"),
    });
    const suggestions: Suggestion[] = [
      suggestion({ id: "s-done", agentRunId: "run-draft-done", reviewStatus: "done" }),
    ];
    const actions = buildNextActions(baseParams({ runs: [draft], suggestions }));
    expect(actions.some((a) => a.id === "auto-run-draft-done")).toBe(false);
  });

  it("確認済み(done)の提案に紐づく Yield も朝キューに出さない", () => {
    const yieldRun = run({
      id: "run-yield-done",
      origin: "manual",
      reviewed: true,
      status: "yield",
      yieldRequest: { kind: "decide", reason: "判断が必要", options: [{ id: "a", label: "A" }] },
    });
    const suggestions: Suggestion[] = [
      suggestion({ id: "s-done", agentRunId: "run-yield-done", reviewStatus: "done" }),
    ];
    const actions = buildNextActions(baseParams({ runs: [yieldRun], suggestions }));
    expect(actions.some((a) => a.id === "yield-run-yield-done")).toBe(false);
  });

  it("未確認の提案に紐づくドラフトは従来どおり出す", () => {
    const draft = run({
      id: "run-draft-open",
      origin: "auto-summary",
      reviewed: false,
      status: "idle",
      proposal: proposal("未確認に紐づく結論"),
    });
    const suggestions: Suggestion[] = [
      suggestion({ id: "s-open", agentRunId: "run-draft-open", reviewStatus: "unreviewed" }),
    ];
    const actions = buildNextActions(baseParams({ runs: [draft], suggestions }));
    expect(actions.some((a) => a.id === "auto-run-draft-open")).toBe(true);
  });

  it("学びの提案・週次／月次レビューは起票トリアージ対象外のため朝キューに出さない", () => {
    const runs: AgentRun[] = [
      run({ id: "run-grow", origin: "auto-grow", reviewed: false, status: "idle" }),
      run({ id: "run-weekly", origin: "auto-weekly-report", reviewed: false, status: "idle" }),
      run({ id: "run-monthly", origin: "auto-monthly-report", reviewed: false, status: "idle" }),
    ];
    const actions = buildNextActions(baseParams({ runs }));
    expect(actions.some((a) => a.id === "auto-run-grow")).toBe(false);
    expect(actions.some((a) => a.id === "auto-run-weekly")).toBe(false);
    expect(actions.some((a) => a.id === "auto-run-monthly")).toBe(false);
  });
});

describe("urgencyMeter", () => {
  it("urgent の判断待ちは high、整備は low 寄り", async () => {
    const { urgencyMeter } = await import("./dashboard-next-actions");
    const high = urgencyMeter({
      id: "error-1",
      severity: "urgent",
      lane: "decision",
      kindLabel: "実行異常",
      since: NOW,
    });
    const low = urgencyMeter({
      id: "maint-1",
      severity: "warn",
      lane: "maintenance",
      kindLabel: "整備",
      since: NOW,
    });
    expect(high.tone).toBe("high");
    expect(high.ratio).toBeGreaterThan(low.ratio);
    expect(low.tone).toBe("low");
  });
});
