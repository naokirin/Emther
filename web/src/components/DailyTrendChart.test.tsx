// @vitest-environment jsdom
//
// jsdomはcanvasの2Dコンテキストを実装していないため、react-chartjs-2が内部でChart.jsの
// canvasレンダリングを行う部分はモックし、「どのデータ・オプションが渡されたか」だけを
// 検証する（積み上げ・欠損値・件数などのロジックはdaily-trends.test.tsで別途担保済み）。
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ChartData } from "chart.js";
import { CheckinTrendChart, JournalIssueTrendChart } from "./DailyTrendChart";
import { buildCheckinDailyTrend, buildJournalIssueDailyTrend, periodWindow } from "@/lib/daily-trends";
import type { EmCheckin, Issue, JournalEntry } from "@/lib/types";

vi.mock("react-chartjs-2", () => ({
  Line: ({ data }: { data: ChartData<"line"> }) => <div data-testid="line-chart" data-chart={JSON.stringify(data)} />,
  Bar: ({ data }: { data: ChartData<"bar"> }) => <div data-testid="bar-chart" data-chart={JSON.stringify(data)} />,
}));

const DAY_MS = 24 * 60 * 60 * 1000;
const TODAY = new Date(2026, 8, 13, 12, 0, 0).getTime();
const WEEK = periodWindow("week", 0, TODAY);

describe("CheckinTrendChart", () => {
  it("記録が無い期間は空状態メッセージを出す", () => {
    render(<CheckinTrendChart points={buildCheckinDailyTrend([], WEEK)} />);
    expect(screen.getByText("この期間のチェックインはまだありません。")).toBeInTheDocument();
  });

  it("チェックインがある期間は3系列（気分/エネルギー/ストレス）を渡す", () => {
    const checkins: EmCheckin[] = [
      { id: "c1", mood: 4, energy: 3, stress: 2, note: "", createdAt: WEEK.start },
      { id: "c2", mood: 2, energy: 2, stress: 4, note: "", createdAt: WEEK.start + 2 * DAY_MS },
    ];
    render(<CheckinTrendChart points={buildCheckinDailyTrend(checkins, WEEK)} />);
    const chart = JSON.parse(screen.getByTestId("line-chart").getAttribute("data-chart")!) as ChartData<"line">;
    expect(chart.labels).toHaveLength(7);
    expect(chart.datasets.map((d) => d.label)).toEqual(["気分", "エネルギー", "ストレス"]);
    // 記録が無い日はnull（線を途切れさせる）
    expect(chart.datasets[0]!.data).toContain(null);
    expect(chart.datasets[0]!.data[0]).toBe(4);
  });
});

function journalEntry(ts: number, sentiment: JournalEntry["sentiment"]): JournalEntry {
  return {
    id: `j-${sentiment}-${Math.random()}`,
    rawText: "",
    tags: [],
    people: [],
    teamIds: [],
    urgency: "low",
    sentiment,
    summary: "",
    createdAt: ts,
    confirmed: true,
  };
}

function issue(createdAt: number): Issue {
  return {
    id: `i-${Math.random()}`,
    title: "",
    charter: { why: "", what: "", how: "" },
    actionItems: [],
    logEntries: [],
    status: "not_started",
    priority: "normal",
    archived: false,
    tags: [],
    createdAt,
    updatedAt: createdAt,
  };
}

describe("JournalIssueTrendChart", () => {
  it("記録が無い期間はJournal/Issue両方の空状態メッセージを出す", () => {
    render(<JournalIssueTrendChart points={buildJournalIssueDailyTrend([], [], WEEK)} />);
    expect(screen.getByText("この期間のJournalはまだありません。")).toBeInTheDocument();
    expect(screen.getByText("この期間のIssueの起票はまだありません。")).toBeInTheDocument();
  });

  it("Journalはネガティブ・ニュートラル・ポジティブの順（積み上げの最下段から）で渡す", () => {
    const journalEntries: JournalEntry[] = [
      journalEntry(WEEK.start, "positive"),
      journalEntry(WEEK.start, "positive"),
      journalEntry(WEEK.start, "negative"),
      journalEntry(WEEK.start + DAY_MS, "neutral"),
    ];
    render(<JournalIssueTrendChart points={buildJournalIssueDailyTrend(journalEntries, [], WEEK)} />);
    const chart = JSON.parse(screen.getAllByTestId("bar-chart")[0]!.getAttribute("data-chart")!) as ChartData<"bar">;
    expect(chart.datasets.map((d) => d.label)).toEqual(["ネガティブ", "ニュートラル", "ポジティブ"]);
    expect(chart.datasets[0]!.data[0]).toBe(1);
    expect(chart.datasets[2]!.data[0]).toBe(2);
  });

  it("Issueは起票の日次件数を渡す", () => {
    const issues: Issue[] = [issue(WEEK.start), issue(WEEK.start)];
    render(<JournalIssueTrendChart points={buildJournalIssueDailyTrend([], issues, WEEK)} />);
    const bars = screen.getAllByTestId("bar-chart");
    const issueChart = JSON.parse(bars[0]!.getAttribute("data-chart")!) as ChartData<"bar">;
    expect(issueChart.datasets.map((d) => d.label)).toEqual(["起票"]);
    expect(issueChart.datasets[0]!.data[0]).toBe(2);
  });
});
