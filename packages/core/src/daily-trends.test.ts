import { describe, expect, it } from "vitest";
import { buildCheckinDailyTrend, buildJournalSuggestionDailyTrend, periodWindow } from "./daily-trends";
import type { EmCheckin, Suggestion, JournalEntry } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;
// 固定の「今日」。2026-09-13は日曜日。ローカルタイムゾーンでの日付境界ズレを避けるため正午に置く。
const TODAY = new Date(2026, 8, 13, 12, 0, 0).getTime();

function checkin(daysAgo: number, mood: number, energy: number, stress: number): EmCheckin {
  return { id: `c-${daysAgo}-${mood}`, mood, energy, stress, note: "", createdAt: TODAY - daysAgo * DAY_MS };
}

describe("periodWindow", () => {
  it("weekは月曜0時始まりの7日間になる", () => {
    const w = periodWindow("week", 0, TODAY);
    const start = new Date(w.start);
    expect(start.getDay()).toBe(1); // 月曜
    expect(start.getHours()).toBe(0);
    expect((w.end - w.start) / DAY_MS).toBe(7);
    // 2026-09-13(日)を含む週の月曜は2026-09-07
    expect(start.getFullYear()).toBe(2026);
    expect(start.getMonth()).toBe(8);
    expect(start.getDate()).toBe(7);
  });

  it("offsetで先週・来週に移動できる", () => {
    const thisWeek = periodWindow("week", 0, TODAY);
    const lastWeek = periodWindow("week", -1, TODAY);
    const nextWeek = periodWindow("week", 1, TODAY);
    expect(lastWeek.end).toBe(thisWeek.start);
    expect(nextWeek.start).toBe(thisWeek.end);
  });

  it("monthはカレンダー月の1日始まりになり、年をまたいでも正しく計算される", () => {
    const thisMonth = periodWindow("month", 0, TODAY);
    expect(new Date(thisMonth.start).getDate()).toBe(1);
    expect(new Date(thisMonth.start).getMonth()).toBe(8); // 9月(0始まり)

    const janBase = new Date(2026, 0, 15).getTime();
    const prevMonth = periodWindow("month", -1, janBase);
    expect(new Date(prevMonth.start).getFullYear()).toBe(2025);
    expect(new Date(prevMonth.start).getMonth()).toBe(11); // 12月
  });
});

describe("buildCheckinDailyTrend", () => {
  it("記録が無い日はnullで欠けを表現する", () => {
    // 2026-09-11 00:00 〜 2026-09-14 00:00 の半開区間＝09-11/09-12/09-13の3日間。
    const window = { start: new Date(2026, 8, 11).getTime(), end: new Date(2026, 8, 14).getTime() };
    const points = buildCheckinDailyTrend([checkin(0, 4, 3, 2)], window);
    expect(points).toHaveLength(3);
    expect(points[0]).toMatchObject({ mood: null, energy: null, stress: null, count: 0 });
    expect(points[1]).toMatchObject({ mood: null, count: 0 });
    expect(points[2]).toMatchObject({ mood: 4, energy: 3, stress: 2, count: 1 });
  });

  it("同じ日の複数チェックインは平均する", () => {
    const window = { start: TODAY, end: TODAY + DAY_MS };
    const points = buildCheckinDailyTrend([checkin(0, 5, 5, 1), checkin(0, 3, 1, 3)], window);
    expect(points[0]).toMatchObject({ mood: 4, energy: 3, stress: 2, count: 2 });
  });

  it("ウィンドウ外のチェックインは数えない", () => {
    const window = { start: TODAY, end: TODAY + DAY_MS };
    const points = buildCheckinDailyTrend([checkin(1, 5, 5, 1)], window);
    expect(points[0]).toMatchObject({ count: 0 });
  });
});

function journalEntry(daysAgo: number, sentiment: JournalEntry["sentiment"]): JournalEntry {
  return {
    id: `j-${daysAgo}-${sentiment}-${Math.random()}`,
    rawText: "",
    tags: [],
    people: [],
    teamIds: [],
    urgency: "low",
    sentiment,
    summary: "",
    createdAt: TODAY - daysAgo * DAY_MS,
    confirmed: true,
  };
}

function suggestion(daysAgo: number): Suggestion {
  return {
    id: `i-${daysAgo}-${Math.random()}`,
    title: "",
    reviewStatus: "unreviewed",
    confirmPriority: "normal",
    memos: [],
    createdAt: TODAY - daysAgo * DAY_MS,
    updatedAt: TODAY - daysAgo * DAY_MS,
  };
}

describe("buildJournalSuggestionDailyTrend", () => {
  it("Journalをsentiment別に日毎集計する", () => {
    const window = { start: TODAY - DAY_MS, end: TODAY + DAY_MS };
    const points = buildJournalSuggestionDailyTrend(
      [journalEntry(0, "positive"), journalEntry(0, "positive"), journalEntry(0, "negative"), journalEntry(1, "neutral")],
      [],
      window,
    );
    expect(points[0]).toMatchObject({ journalPositive: 0, journalNeutral: 1, journalTotal: 1 });
    expect(points[1]).toMatchObject({ journalPositive: 2, journalNegative: 1, journalNeutral: 0, journalTotal: 3 });
  });

  it("提案は起票日ごとに数える", () => {
    const window = { start: TODAY - DAY_MS, end: TODAY + DAY_MS };
    const points = buildJournalSuggestionDailyTrend([], [suggestion(1), suggestion(1)], window);
    expect(points[0]).toMatchObject({ suggestionCreated: 2 });
    expect(points[1]).toMatchObject({ suggestionCreated: 0 });
  });

  it("ウィンドウ外の提案/Journalは数えない", () => {
    const window = { start: TODAY, end: TODAY + DAY_MS };
    const points = buildJournalSuggestionDailyTrend([journalEntry(2, "positive")], [suggestion(2)], window);
    expect(points[0]).toMatchObject({ journalTotal: 0, suggestionCreated: 0 });
  });
});
