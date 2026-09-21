import styles from "../../styles/page.module.css";
import type { VitalStatus } from "@emther/core/types";
import type { EntityHealthBreakdown, TodayStateMeters } from "../../lib/today-state";
import { extractRecentActivities } from "./AgentStatusSection";
import type { AgentRun } from "../RunDetail";

type Props = {
  meters: TodayStateMeters;
  loaded: boolean;
  runs: AgentRun[];
  runsLoaded: boolean;
  autoRunsToday: number;
  /** 設定「1on1 Coverage」の判定参照期間（日） */
  coverageWindowDays: number;
  onNavigate: (path: string) => void;
  now: number;
};

const BUCKET_LABEL: Record<VitalStatus, string> = {
  good: "良い",
  warn: "要注意",
  bad: "危険",
  unknown: "未観測",
};

const BUCKET_COLOR: Record<VitalStatus, string> = {
  good: "var(--green-border, #22c55e)",
  warn: "var(--yellow-border, #eab308)",
  bad: "var(--red-border, #e5534b)",
  unknown: "var(--gray-border, #686e7d)",
};

const DIAL_IDLE = "#3a3f4b";

type DialTone = "good" | "warn" | "bad" | "accent" | "unknown";

const DIAL_TONE_COLOR: Record<DialTone, string> = {
  good: "#4ade80",
  warn: "#fbbf24",
  bad: "#e5534b",
  accent: "#7fb0ff",
  unknown: "#686e7d",
};

/** EM負荷: 低いほど良い。 */
export function loadTone(ratio: number): DialTone {
  if (ratio >= 0.75) return "bad";
  if (ratio >= 0.4) return "warn";
  return "good";
}

/** 健全度・カバレッジ: 高いほど良い。カバレッジは良いとき accent。 */
export function healthTone(ratio: number | null): DialTone {
  if (ratio === null) return "unknown";
  if (ratio >= 0.7) return "good";
  if (ratio >= 0.4) return "warn";
  return "bad";
}

export function coverageTone(ratio: number | null): DialTone {
  if (ratio === null) return "unknown";
  if (ratio >= 0.7) return "accent";
  if (ratio >= 0.4) return "warn";
  return "bad";
}

function DotDial({
  valueLabel,
  caption,
  ticks,
  filled,
  tone,
  title,
}: {
  valueLabel: string;
  caption: string;
  ticks: number;
  filled: number;
  tone: DialTone;
  title?: string;
}) {
  const color = DIAL_TONE_COLOR[tone];
  const onCount = Math.max(0, Math.min(ticks, Math.round(filled)));
  const size = 96;
  const radius = 38;
  const cx0 = size / 2;
  const cy0 = size / 2;
  const dots = Array.from({ length: ticks }, (_, i) => {
    // 12時から時計回り
    const angle = (-90 + (360 / ticks) * i) * (Math.PI / 180);
    return {
      cx: cx0 + radius * Math.cos(angle),
      cy: cy0 + radius * Math.sin(angle),
      on: i < onCount,
    };
  });

  return (
    <div className={styles.nowStateDialCard} title={title}>
      <div className={styles.nowStateDotDial} style={{ width: size, height: size }} aria-hidden>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          {dots.map((d, i) => (
            <circle key={i} cx={d.cx} cy={d.cy} r={5} fill={d.on ? color : DIAL_IDLE} />
          ))}
        </svg>
        <span className={styles.nowStateDialValue}>{valueLabel}</span>
      </div>
      <span className={styles.nowStateDialCaption}>{caption}</span>
    </div>
  );
}

function HealthSide({ title, breakdown }: { title: string; breakdown: EntityHealthBreakdown }) {
  const segments = breakdown.buckets
    .filter((b) => b.count > 0)
    .map((b) => ({ ...b, color: BUCKET_COLOR[b.status] }));
  const total = Math.max(1, breakdown.total);
  let cursor = 0;
  const stops: string[] = [];
  for (const seg of segments) {
    const start = (cursor / total) * 100;
    cursor += seg.count;
    const end = (cursor / total) * 100;
    stops.push(`${seg.color} ${start}% ${end}%`);
  }
  const pie =
    segments.length === 0
      ? "var(--border, #2c2f3a)"
      : `conic-gradient(${stops.join(", ")})`;

  return (
    <div className={styles.nowStateHealthCard}>
      <div className={styles.nowStateHealthContent}>
        <div className={styles.nowStateHealthPie} style={{ background: pie }} aria-hidden>
          <div className={styles.nowStateHealthPieInner}>
            <span className={styles.nowStateHealthTotal}>{breakdown.total}</span>
          </div>
        </div>
        <div className={styles.nowStateHealthSide}>
          <span className={styles.nowStateHealthTitle}>{title}</span>
          {breakdown.buckets.length === 0 ? (
            <span className={styles.nowStateHealthLine}>—</span>
          ) : (
            breakdown.buckets.map((b) => (
              <span key={b.status} className={styles.nowStateHealthLine}>
                <i className={styles.nowStateHealthSwatch} style={{ background: BUCKET_COLOR[b.status] }} aria-hidden />
                {BUCKET_LABEL[b.status]} {b.count}
                {b.examples.length > 0 ? ` · ${b.examples.join("、")}` : ""}
              </span>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// docs/design/dashboard/today-tab.pen 改善案A対応。「いまの状態」を程度で掴む先頭パネル。
export function NowStatePanel({
  meters,
  loaded,
  runs,
  runsLoaded,
  autoRunsToday,
  coverageWindowDays,
  onNavigate,
  now,
}: Props) {
  if (!loaded) {
    return (
      <div className={styles.panel}>
        <h2 className={styles.nowStateHeading}>いまの状態</h2>
        <p className={styles.subtitle}>読み込み中…</p>
      </div>
    );
  }

  const activeCount = runs.filter((r) => r.status === "active" || r.status === "queued").length;
  const latest = runsLoaded ? extractRecentActivities(runs, 1, now)[0] : undefined;
  const pulseText = !runsLoaded
    ? "エージェント状態を読み込み中…"
    : activeCount > 0
      ? `エージェント実行中 ${activeCount}件${latest ? ` · 最終巡回 ${latest.timeLabel}` : ""}${autoRunsToday > 0 ? ` · 本日自動 ${autoRunsToday}件` : ""}`
      : `エージェント待機中${latest ? ` · 最終巡回 ${latest.timeLabel}` : ""}${autoRunsToday > 0 ? ` · 本日自動 ${autoRunsToday}件` : ""}`;

  // 超過時も比率は 1 で頭打ち（色・点リングは満杯）。数値ラベルは実数のまま。
  const loadRatio =
    meters.emLoad.max > 0 ? Math.min(1, meters.emLoad.current / meters.emLoad.max) : 0;
  const healthRatio = meters.orgHealthPercent === null ? null : meters.orgHealthPercent / 100;
  const coverageRatio =
    meters.oneOnOneCoveragePercent === null ? null : meters.oneOnOneCoveragePercent / 100;

  // EM負荷の目盛はソフト上限。健全度・カバレッジは 12 目盛。
  const loadTicks = Math.max(1, meters.emLoad.max);
  const loadFilled = Math.min(loadTicks, meters.emLoad.current);
  const healthFilled = healthRatio === null ? 0 : Math.round(healthRatio * 12);
  const coverageFilled = coverageRatio === null ? 0 : Math.round(coverageRatio * 12);
  // 超過時は実数をキャップせず、分母側に「+」を付けてソフト上限超えを示す（例: 7+/7）。
  // ホバーで実件数を確認できるようにする。
  const emLoadOver = meters.emLoad.current > meters.emLoad.max;
  const emLoadLabel = emLoadOver
    ? `${meters.emLoad.max}+/${meters.emLoad.max}`
    : `${meters.emLoad.current}/${meters.emLoad.max}`;
  const emLoadTitle = emLoadOver
    ? `朝キュー ${meters.emLoad.current} 件（ソフト上限 ${meters.emLoad.max} を超過）`
    : `朝キュー ${meters.emLoad.current} / ソフト上限 ${meters.emLoad.max}`;

  return (
    <div className={styles.panel} data-testid="now-state-panel">
      <div className={styles.nowStateHeader}>
        <h2 className={styles.nowStateHeading}>いまの状態</h2>
        <span className={styles.subtitle} style={{ margin: 0 }}>
          程度で掴む · 詳細は下へ
        </span>
      </div>

      <div className={styles.nowStateDialRow}>
        <DotDial
          valueLabel={emLoadLabel}
          caption="EM負荷（今日の上限感）"
          ticks={loadTicks}
          filled={loadFilled}
          tone={loadTone(loadRatio)}
          title={emLoadTitle}
        />
        <DotDial
          valueLabel={meters.orgHealthPercent === null ? "—" : `${meters.orgHealthPercent}%`}
          caption="組織健全度（良/注/危の加重）"
          ticks={12}
          filled={healthFilled}
          tone={healthTone(healthRatio)}
        />
        <DotDial
          valueLabel={
            meters.oneOnOneCoveragePercent === null ? "—" : `${meters.oneOnOneCoveragePercent}%`
          }
          caption={`1on1カバレッジ（直近${coverageWindowDays}日）`}
          ticks={12}
          filled={coverageFilled}
          tone={coverageTone(coverageRatio)}
        />
      </div>

      <div className={styles.nowStateHealthRow}>
        <HealthSide title="チーム" breakdown={meters.teamHealth} />
        <HealthSide title="メンバー" breakdown={meters.personHealth} />
      </div>

      <div className={styles.nowStatePulse}>
        <span className={styles.nowStatePulseDot} data-active={activeCount > 0 ? "1" : "0"} aria-hidden />
        <span className={styles.nowStatePulseText}>{pulseText}</span>
        <button type="button" className={styles.nowStatePulseLink} onClick={() => onNavigate("/agents")}>
          動きを見る →
        </button>
      </div>
    </div>
  );
}
