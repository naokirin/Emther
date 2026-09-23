import type { AgentRun } from "@emther/core/agent-runtime";
import { periodWindow } from "@emther/core/daily-trends";

// docs/design/dashboard/today-tab.pen 改善案B対応。週次・月次レポートの弱い案内帯。
// 未読判定は localStorage（サーバー既読は持たない軽量実装）。

export type ReportNudgeKind = "weekly" | "monthly";

export type ReportNudge = {
  kind: ReportNudgeKind;
  /** localStorage キー用の期間ID（週は月曜日付、月は YYYY-MM） */
  periodKey: string;
  runId: string;
  eyebrow: string;
  body: string;
  linkLabel: string;
};

const STORAGE_PREFIX = "em-report-seen:";

function dateKey(ts: number): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function monthKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, "0")}`;
}

export function reportSeenStorageKey(kind: ReportNudgeKind, periodKey: string): string {
  return `${STORAGE_PREFIX}${kind}:${periodKey}`;
}

export function isReportPeriodSeen(kind: ReportNudgeKind, periodKey: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(reportSeenStorageKey(kind, periodKey)) === "1";
  } catch {
    return false;
  }
}

export function markReportPeriodSeen(kind: ReportNudgeKind, periodKey: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(reportSeenStorageKey(kind, periodKey), "1");
  } catch {
    // 既読を諦められるだけで閲覧自体は妨げない
  }
}

function isCompletedReportRun(run: AgentRun, origin: AgentRun["origin"]): boolean {
  return run.origin === origin && run.status === "idle" && !!run.periodReview;
}

/** 月曜=1 … 日曜=0。月曜〜火曜朝（0〜1）だけ週次帯を出す。 */
function isWeeklyNudgeDay(now: number): boolean {
  const day = new Date(now).getDay();
  return day === 1 || day === 2;
}

/** 月初1〜5日だけ月次帯を出す。 */
function isMonthlyNudgeDay(now: number): boolean {
  return new Date(now).getDate() <= 5;
}

function latestCompletedRun(runs: AgentRun[], origin: AgentRun["origin"]): AgentRun | null {
  let best: AgentRun | null = null;
  for (const run of runs) {
    if (!isCompletedReportRun(run, origin)) continue;
    if (!best || run.updatedAt > best.updatedAt) best = run;
  }
  return best;
}

export type SelectReportNudgesParams = {
  now: number;
  runs: AgentRun[];
  /** テスト用: localStorage の代わりに既読判定を差し替える */
  isSeen?: (kind: ReportNudgeKind, periodKey: string) => boolean;
};

export type ReportNudgeSelection = {
  primary: ReportNudge | null;
  /** 月曜かつ月初で週次を主にしたときの月次副導線 */
  secondary: ReportNudge | null;
};

export function selectReportNudges(params: SelectReportNudgesParams): ReportNudgeSelection {
  const { now, runs, isSeen = isReportPeriodSeen } = params;
  const showWeekly = isWeeklyNudgeDay(now);
  const showMonthly = isMonthlyNudgeDay(now);

  let weekly: ReportNudge | null = null;
  let monthly: ReportNudge | null = null;

  if (showWeekly) {
    const run = latestCompletedRun(runs, "auto-weekly-report");
    if (run) {
      // 先週分のレビューを想定（完了 run の更新週、なければ先週ウィンドウ）
      const lastWeek = periodWindow("week", -1, now);
      const periodKey = dateKey(lastWeek.start);
      if (!isSeen("weekly", periodKey)) {
        weekly = {
          kind: "weekly",
          periodKey,
          runId: run.id,
          eyebrow: showMonthly ? "月曜 · 週次（月初と重なる週）" : "月曜 · 週次",
          body: "先週の週次レビューがあります。日次で抑えている後回し・確認保留の提案の見直しや、提案整理のきっかけにも使えます。",
          linkLabel: showMonthly ? "週次レポート" : "レポートを見る",
        };
      }
    }
  }

  if (showMonthly) {
    const run = latestCompletedRun(runs, "auto-monthly-report");
    if (run) {
      const lastMonth = periodWindow("month", -1, now);
      const periodKey = monthKey(lastMonth.start);
      if (!isSeen("monthly", periodKey)) {
        monthly = {
          kind: "monthly",
          periodKey,
          runId: run.id,
          eyebrow: "月初 · 月次",
          body: "先月の月次レビューがあります。空いたときにレポートで確認できます。",
          linkLabel: "レポートを見る",
        };
      }
    }
  }

  if (weekly && monthly) {
    return {
      primary: weekly,
      secondary: {
        ...monthly,
        eyebrow: "月次",
        body: "先月の月次レビューもあります。",
        linkLabel: "月次レポート",
      },
    };
  }
  if (weekly) return { primary: weekly, secondary: null };
  if (monthly) return { primary: monthly, secondary: null };
  return { primary: null, secondary: null };
}
