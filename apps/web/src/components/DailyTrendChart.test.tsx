//
// jsdomはcanvasの2Dコンテキストを実装していないため、react-chartjs-2が内部でChart.jsの
// canvasレンダリングを行う部分はモックし、「どのデータ・オプションが渡されたか」だけを
// 検証する（積み上げ・欠損値・件数などのロジックはdaily-trends.test.tsで別途担保済み）。
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Chart, ChartData } from "chart.js";
import { CheckinTrendChart, jitterPointsPlugin, JournalSuggestionTrendChart } from "./DailyTrendChart";
import { buildCheckinDailyTrend, buildJournalSuggestionDailyTrend, periodWindow } from "@emther/core/daily-trends";
import type { EmCheckin, JournalEntry, Suggestion } from "@emther/core/types";

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

  it("チェックインがある期間は4系列で、ストレスは反転して渡す", () => {
    const checkins: EmCheckin[] = [
      { id: "c1", mood: 4, energy: 3, stress: 2, headroom: 4, note: "", createdAt: WEEK.start },
      { id: "c2", mood: 2, energy: 2, stress: 4, headroom: 2, note: "", createdAt: WEEK.start + 2 * DAY_MS },
    ];
    render(<CheckinTrendChart points={buildCheckinDailyTrend(checkins, WEEK)} />);
    const chart = JSON.parse(screen.getByTestId("line-chart").getAttribute("data-chart")!) as ChartData<"line">;
    expect(chart.labels).toHaveLength(7);
    expect(chart.datasets.map((d) => d.label)).toEqual(["気分", "エネルギー", "ストレス", "心の余裕"]);
    // 記録が無い日はnull（線を途切れさせる）
    expect(chart.datasets[0]!.data).toContain(null);
    expect(chart.datasets[0]!.data[0]).toBe(4);
    // stress=2 → チャート上は 6-2=4（上＝良い）
    expect(chart.datasets[2]!.data[0]).toBe(4);
    expect(chart.datasets[3]!.data[0]).toBe(4);
  });

  it("headroomが無い旧データでも落ちず、心の余裕系列はnull", () => {
    const checkins: EmCheckin[] = [{ id: "c1", mood: 3, energy: 3, stress: 3, note: "", createdAt: WEEK.start }];
    render(<CheckinTrendChart points={buildCheckinDailyTrend(checkins, WEEK)} />);
    const chart = JSON.parse(screen.getByTestId("line-chart").getAttribute("data-chart")!) as ChartData<"line">;
    expect(chart.datasets[3]!.data[0]).toBeNull();
  });
});

// ユーザー指摘「Chart.jsのアニメーションで位置が上書きされ、結局点が重なる」および
// 「マウスオーバーのたびにどんどん離れていく」対応の回帰テスト。
// - 1回目: afterDatasetsUpdate（chart.update()時に1回だけ発火）でずらすと、その後の
//   毎フレームのアニメーションTickでx/yがジッター無しのターゲット値へ再設定され、
//   静止後には結局元の位置へ戻ってしまっていた → beforeDatasetsDraw（draw()直前・
//   毎フレーム発火）へ変更。
// - 2回目: beforeDatasetsDrawでも`point.x += offset`という相対加算のままだと、ホバーに
//   よるツールチップ再描画（controller.update()を経由せずdraw()だけ呼ばれる）のたびに
//   既にジッター済みのx値へさらに加算してしまい、離れ続けていた → x軸スケールから
//   indexごとの本来位置を毎回算出し、そこへoffsetを足した絶対値で上書きするよう変更。
describe("jitterPointsPlugin", () => {
  function fakeChart(datasetCount: number, pointCountPerDataset: number): Chart<"line"> {
    const metas = Array.from({ length: datasetCount }, () => ({
      data: Array.from({ length: pointCountPerDataset }, () => ({ x: 999 })),
    }));
    return {
      data: { datasets: Array.from({ length: datasetCount }, () => ({})) },
      scales: { x: { getPixelForValue: (index: number) => 100 + index * 10 } },
      getDatasetMeta: (i: number) => metas[i],
    } as unknown as Chart<"line">;
  }

  it("毎フレーム呼ばれるbeforeDatasetsDrawでずらす（chart.update()時だけのafterDatasetsUpdateではない）", () => {
    expect(jitterPointsPlugin.beforeDatasetsDraw).toBeTypeOf("function");
    expect(jitterPointsPlugin.afterDatasetsUpdate).toBeUndefined();
  });

  it("datasetIndexに応じて中心対称にx位置をずらす（indexごとのscale位置基準）", () => {
    const chart = fakeChart(3, 2);
    jitterPointsPlugin.beforeDatasetsDraw!(chart, {} as never, {});
    expect([0, 1, 2].map((d) => chart.getDatasetMeta(d).data[0]!.x)).toEqual([97, 100, 103]);
    expect([0, 1, 2].map((d) => chart.getDatasetMeta(d).data[1]!.x)).toEqual([107, 110, 113]);
  });

  it("ホバー再描画に相当する繰り返し呼び出しでもx位置が積み上がらない", () => {
    const chart = fakeChart(3, 1);
    jitterPointsPlugin.beforeDatasetsDraw!(chart, {} as never, {});
    jitterPointsPlugin.beforeDatasetsDraw!(chart, {} as never, {});
    jitterPointsPlugin.beforeDatasetsDraw!(chart, {} as never, {});
    expect([0, 1, 2].map((d) => chart.getDatasetMeta(d).data[0]!.x)).toEqual([97, 100, 103]);
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

function suggestion(createdAt: number): Suggestion {
  return {
    id: `s-${Math.random()}`,
    title: "",
    reviewStatus: "unreviewed",
    confirmPriority: "normal",
    memos: [],
    createdAt,
    updatedAt: createdAt,
  };
}

describe("JournalSuggestionTrendChart", () => {
  it("記録が無い期間はJournal/提案両方の空状態メッセージを出す", () => {
    render(<JournalSuggestionTrendChart points={buildJournalSuggestionDailyTrend([], [], WEEK)} />);
    expect(screen.getByText("この期間のJournalはまだありません。")).toBeInTheDocument();
    expect(screen.getByText("この期間の提案の起票はまだありません。")).toBeInTheDocument();
  });

  it("Journalはネガティブ・ニュートラル・ポジティブの順（積み上げの最下段から）で渡す", () => {
    const journalEntries: JournalEntry[] = [
      journalEntry(WEEK.start, "positive"),
      journalEntry(WEEK.start, "positive"),
      journalEntry(WEEK.start, "negative"),
      journalEntry(WEEK.start + DAY_MS, "neutral"),
    ];
    render(<JournalSuggestionTrendChart points={buildJournalSuggestionDailyTrend(journalEntries, [], WEEK)} />);
    const chart = JSON.parse(screen.getAllByTestId("bar-chart")[0]!.getAttribute("data-chart")!) as ChartData<"bar">;
    expect(chart.datasets.map((d) => d.label)).toEqual(["ネガティブ", "ニュートラル", "ポジティブ"]);
    expect(chart.datasets[0]!.data[0]).toBe(1);
    expect(chart.datasets[2]!.data[0]).toBe(2);
  });

  it("提案は起票の日次件数を渡す", () => {
    const suggestions: Suggestion[] = [suggestion(WEEK.start), suggestion(WEEK.start)];
    render(<JournalSuggestionTrendChart points={buildJournalSuggestionDailyTrend([], suggestions, WEEK)} />);
    const bars = screen.getAllByTestId("bar-chart");
    const suggestionChart = JSON.parse(bars[0]!.getAttribute("data-chart")!) as ChartData<"bar">;
    expect(suggestionChart.datasets.map((d) => d.label)).toEqual(["起票"]);
    expect(suggestionChart.datasets[0]!.data[0]).toBe(2);
  });
});
