"use client";

import { useState } from "react";
import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
  type ChartData,
  type ChartOptions,
} from "chart.js";
import { Bar, Line } from "react-chartjs-2";
import styles from "@/app/page.module.css";
import { periodWindow, type CheckinDailyPoint, type JournalIssueDailyPoint, type PeriodUnit } from "@/lib/daily-trends";

// 改修依頼「マウスオーバーで数値を確認したい／先週・先月など時間を自由に移動したい」対応。
// 素のSVG自作から、ホバーツールチップ・積み上げ/グループ棒を標準で持つChart.jsへ移行する
// （bundlephobia調べ: Chart.js本体はgzip約68KB、Rechartsの約148KBの半分以下）。
// 必要な要素だけを登録し、chart.js/autoは使わずツリーシェイクする。
ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Tooltip, Legend);

// canvasのfillStyle/strokeStyleはCSSのvar()を解決できないため、globals.cssのトークンと
// 同じ16進値をここに複製する（デザイン変更時はこちらも合わせて直すこと）。
const CHART_COLORS = {
  border: "#2c2f3a",
  textMuted: "#9aa1af",
  foreground: "#e7e9ee",
  tooltipBg: "#22252e",
  green: "#4ade80",
  red: "#f87171",
  blue: "#7fb0ff",
  gray: "#9aa1af",
};

const TOOLTIP_STYLE = {
  backgroundColor: CHART_COLORS.tooltipBg,
  titleColor: CHART_COLORS.foreground,
  bodyColor: CHART_COLORS.foreground,
  borderColor: CHART_COLORS.border,
  borderWidth: 1,
  padding: 8,
  boxPadding: 4,
} as const;

const LEGEND_LABEL_STYLE = {
  color: CHART_COLORS.textMuted,
  boxWidth: 10,
  boxHeight: 10,
  font: { size: 11 },
  usePointStyle: false,
} as const;

const AXIS_TICK_STYLE = { color: CHART_COLORS.textMuted, font: { size: 11 } } as const;

// ---------- 期間ナビゲーション（週／月をカレンダー単位で前後に移動） ----------

export function usePeriodNavigator(defaultUnit: PeriodUnit = "week") {
  const [unit, setUnitRaw] = useState<PeriodUnit>(defaultUnit);
  const [offset, setOffset] = useState(0);
  const window = periodWindow(unit, offset);

  function setUnit(next: PeriodUnit) {
    setUnitRaw(next);
    setOffset(0);
  }

  return { unit, setUnit, offset, setOffset, window, label: window.label, isLatest: offset === 0 };
}

export type PeriodNavigatorState = ReturnType<typeof usePeriodNavigator>;

const UNIT_LABEL: Record<PeriodUnit, string> = { week: "週", month: "月" };

// /growth・/reportsで共有する期間ナビゲーション。単位（週/月）チップ＋前後移動＋現在へ戻る。
export function PeriodNavigator({ state }: { state: PeriodNavigatorState }) {
  const { unit, setUnit, offset, setOffset, label, isLatest } = state;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <div role="group" aria-label="表示単位" style={{ display: "flex", gap: 6 }}>
        {(["week", "month"] as const).map((u) => (
          <button
            key={u}
            type="button"
            className={`${styles.typeChip} ${unit === u ? styles.typeChipSelected : ""}`}
            onClick={() => setUnit(u)}
          >
            {UNIT_LABEL[u]}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <button type="button" className={styles.btnOutline} aria-label="前の期間" onClick={() => setOffset(offset - 1)}>
          ◀
        </button>
        <span className={styles.subtitle} style={{ minWidth: 0, whiteSpace: "nowrap" }}>
          {label}
        </span>
        <button type="button" className={styles.btnOutline} aria-label="次の期間" onClick={() => setOffset(offset + 1)}>
          ▶
        </button>
        {!isLatest && (
          <button type="button" className={styles.btnOutline} onClick={() => setOffset(0)}>
            今{UNIT_LABEL[unit]}に戻る
          </button>
        )}
      </div>
    </div>
  );
}

// ---------- チェックイン（気分・エネルギー・ストレス）の折れ線 ----------

type CheckinLineKey = "mood" | "energy" | "stress";
// mood/stressは自己申告の良し悪しの向きそのものが既存のgreen/redの意味と一致する。
// energyは「操作可能な資源」に近い意味でblueを当てる。
const CHECKIN_LINES: { key: CheckinLineKey; label: string; color: string }[] = [
  { key: "mood", label: "気分", color: CHART_COLORS.green },
  { key: "energy", label: "エネルギー", color: CHART_COLORS.blue },
  { key: "stress", label: "ストレス", color: CHART_COLORS.red },
];

function checkinChartOptions(pointCount: number): ChartOptions<"line"> {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { position: "bottom", labels: LEGEND_LABEL_STYLE },
      tooltip: { ...TOOLTIP_STYLE, callbacks: { label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y == null ? "記録なし" : ctx.parsed.y.toFixed(1)}` } },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { ...AXIS_TICK_STYLE, maxRotation: 0, autoSkipPadding: 12 },
      },
      y: {
        min: 1,
        max: 5,
        ticks: { ...AXIS_TICK_STYLE, stepSize: 1 },
        grid: { color: CHART_COLORS.border },
      },
    },
    elements: {
      point: { radius: pointCount <= 31 ? 3 : 0, hoverRadius: 5, hitRadius: 8 },
      line: { borderWidth: 2, tension: 0 },
    },
  };
}

// EMの成長: チェックイン（気分・エネルギー・ストレス）の日次推移。記録が無い日は
// null（折れ線を繋げず途切れさせる）にして、「この日は記録が少ない」ことも見えるようにする。
export function CheckinTrendChart({ points }: { points: CheckinDailyPoint[] }) {
  const hasAnyData = points.some((p) => p.count > 0);
  const data: ChartData<"line"> = {
    labels: points.map((p) => p.label),
    datasets: CHECKIN_LINES.map((series) => ({
      label: series.label,
      data: points.map((p) => p[series.key]),
      borderColor: series.color,
      backgroundColor: series.color,
      spanGaps: false,
    })),
  };

  return (
    <div className={styles.trendChart}>
      <div className={styles.trendChartCanvasWrap}>
        <Line data={data} options={checkinChartOptions(points.length)} />
      </div>
      {!hasAnyData && <p className={styles.tableEmpty}>この期間のチェックインはまだありません。</p>}
    </div>
  );
}

// ---------- Journal(sentiment別)・Issue(起票/解決)の日次件数 ----------

type CountSeriesKey = keyof Pick<
  JournalIssueDailyPoint,
  "journalPositive" | "journalNeutral" | "journalNegative" | "issueCreated" | "issueDone"
>;
type CountSeries = { key: CountSeriesKey; label: string; color: string };

// sentimentはJournalEntryの状態そのものなので既存のステータス色をそのまま使う。
// 積み上げは配列の並び順が下から上の順になる（Chart.jsの仕様）。基線に近い最下段ほど
// 比較しやすいため、着目したいネガティブを先頭（最下段）に置く。
const SENTIMENT_SERIES: CountSeries[] = [
  { key: "journalNegative", label: "ネガティブ", color: CHART_COLORS.red },
  { key: "journalNeutral", label: "ニュートラル", color: CHART_COLORS.gray },
  { key: "journalPositive", label: "ポジティブ", color: CHART_COLORS.green },
];

const ISSUE_SERIES: CountSeries[] = [
  { key: "issueCreated", label: "起票", color: CHART_COLORS.blue },
  { key: "issueDone", label: "解決", color: CHART_COLORS.green },
];

function countChartOptions(stacked: boolean): ChartOptions<"bar"> {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { position: "bottom", labels: LEGEND_LABEL_STYLE },
      tooltip: { ...TOOLTIP_STYLE, callbacks: { label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y}件` } },
    },
    scales: {
      x: { stacked, grid: { display: false }, ticks: { ...AXIS_TICK_STYLE, maxRotation: 0, autoSkipPadding: 12 } },
      y: { stacked, beginAtZero: true, ticks: { ...AXIS_TICK_STYLE, precision: 0 }, grid: { color: CHART_COLORS.border } },
    },
  };
}

function buildCountChartData(points: JournalIssueDailyPoint[], series: CountSeries[], stackKey?: string): ChartData<"bar"> {
  return {
    labels: points.map((p) => p.label),
    datasets: series.map((s) => ({
      label: s.label,
      data: points.map((p) => p[s.key]),
      backgroundColor: s.color,
      borderRadius: 3,
      borderSkipped: false,
      ...(stackKey ? { stack: stackKey } : {}),
    })),
  };
}

// タイムライン／レポート: Journal(sentiment別)とIssue(起票・解決)の日次件数。
// 「この日は記録が少ない」「ネガティブ・ポジティブの多寡」を積み上げ棒で、
// 「業務状況（起票・解決の勢い）」をIssue側の棒で読む。
export function JournalIssueTrendChart({ points }: { points: JournalIssueDailyPoint[] }) {
  const hasJournal = points.some((p) => p.journalTotal > 0);
  const hasIssue = points.some((p) => p.issueCreated > 0 || p.issueDone > 0);

  return (
    <div className={styles.trendChart}>
      <div className={styles.fieldCaption}>Journal（sentiment別・日次件数）</div>
      {hasJournal ? (
        <div className={styles.trendChartCanvasWrapSmall}>
          <Bar data={buildCountChartData(points, SENTIMENT_SERIES, "journal")} options={countChartOptions(true)} />
        </div>
      ) : (
        <p className={styles.tableEmpty}>この期間のJournalはまだありません。</p>
      )}

      <div className={styles.fieldCaption} style={{ marginTop: 18 }}>
        Issue（起票・解決の日次件数）
      </div>
      {hasIssue ? (
        <div className={styles.trendChartCanvasWrapSmall}>
          <Bar data={buildCountChartData(points, ISSUE_SERIES)} options={countChartOptions(false)} />
        </div>
      ) : (
        <p className={styles.tableEmpty}>この期間のIssueの起票・解決はまだありません。</p>
      )}
    </div>
  );
}
