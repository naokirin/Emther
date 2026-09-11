"use client";

import styles from "@/app/page.module.css";
import type { AgentRun } from "@/components/RunDetail";
import { consultListSecondary, consultListTitle, truncateExcerpt } from "@/lib/origin-trace";

const TITLE_MAX = 100;
const SECONDARY_MAX = 120;

const STATUS_SHORT: Record<AgentRun["status"], string> = {
  active: "実行中",
  queued: "順番待ち",
  yield: "Yield",
  idle: "完了",
  error: "エラー",
};

const ORIGIN_SHORT: Record<AgentRun["origin"], string> = {
  manual: "",
  "auto-anomaly": "Journal自動分析",
  "auto-summary": "朝のサマリー",
  "auto-issue-update": "Issue更新分析",
  "auto-distill": "状況蒸留",
};

const TRIAGE_SHORT: Record<"watching" | "dismissed", string> = {
  watching: "様子見",
  dismissed: "却下",
};

export function formatConsultListTime(ts: number, now = Date.now()): string {
  const d = new Date(ts);
  const n = new Date(now);
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(n) - startOf(d)) / (24 * 60 * 60 * 1000));
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  const time = `${hh}:${mi}`;
  if (diffDays === 0) return `今日 ${time}`;
  if (diffDays === 1) return `昨日 ${time}`;
  return `${d.getMonth() + 1}/${d.getDate()} ${time}`;
}

export function consultListMetaParts(
  run: Pick<AgentRun, "origin" | "status" | "reviewed" | "triageStatus" | "sourceJournalId" | "updatedAt">,
  opts: { stale?: boolean; now?: number; omitTime?: boolean; omitTriage?: boolean } = {},
): string[] {
  const parts: string[] = [];
  // 今日タブの様子見一覧は「経過」列があるので日時を省略できる。
  if (!opts.omitTime) parts.push(formatConsultListTime(run.updatedAt, opts.now));
  parts.push(opts.stale && run.status === "active" ? "応答なし" : STATUS_SHORT[run.status]);
  const origin = ORIGIN_SHORT[run.origin] || (run.sourceJournalId ? "Journalから" : "");
  if (origin) parts.push(origin);
  if (run.origin !== "manual" && !run.reviewed) parts.push("未確認");
  // 様子見セクション内では「様子見」ラベルは冗長なので省略できる。
  if (run.triageStatus && !opts.omitTriage) parts.push(TRIAGE_SHORT[run.triageStatus]);
  return parts;
}

export function ConsultHistoryItem({
  run,
  selected,
  stale,
  onSelect,
}: {
  run: AgentRun;
  selected: boolean;
  stale?: boolean;
  onSelect: () => void;
}) {
  const title = truncateExcerpt(consultListTitle(run), TITLE_MAX);
  const secondary = consultListSecondary(run);
  const meta = consultListMetaParts(run, { stale }).join(" · ");

  return (
    <button
      id={`chat-history-${run.id}`}
      className={`${styles.runItem} ${selected ? styles.selected : ""}`}
      onClick={onSelect}
    >
      <div className={styles.runItemTitle}>{title}</div>
      {secondary && <div className={styles.runItemSecondary}>{truncateExcerpt(secondary, SECONDARY_MAX)}</div>}
      <div className={styles.runItemMeta}>{meta}</div>
    </button>
  );
}
