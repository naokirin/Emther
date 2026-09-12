"use client";

import type { ReactNode } from "react";
import styles from "@/app/page.module.css";
import {
  ISSUE_STATUSES,
  ISSUE_STATUS_META,
  ISSUE_PRIORITIES,
  ISSUE_PRIORITY_META,
  type IssuePriority,
  type IssueStatus,
  type IssueTriageScores,
} from "@/lib/types";

const STATUS_CLS: Record<IssueStatus, string> = {
  not_started: styles.issueStatusNotStarted,
  in_progress: styles.issueStatusInProgress,
  blocked: styles.issueStatusBlocked,
  done: styles.issueStatusDone,
};

// docs/em_ui_ux_issue.md 4節「ステータス管理の導入」対応。一覧・ボード・詳細で共通の表示。
export function IssueStatusBadge({ status }: { status: IssueStatus }) {
  const meta = ISSUE_STATUS_META[status];
  return (
    <span className={`${styles.issueStatusBadge} ${STATUS_CLS[status]}`}>
      {meta.icon} {meta.label}
    </span>
  );
}

export function IssuePriorityBadge({ priority }: { priority: IssuePriority }) {
  const meta = ISSUE_PRIORITY_META[priority];
  return (
    <span className={styles.issueStatusBadge} title={meta.hint}>
      {meta.icon} {meta.label}
    </span>
  );
}

/** docs/value_hierarchy_and_flow.md §4.3。計算式は出さず、4軸だけを人が読めるラベルで示す。 */
export const TRIAGE_AXIS_META = [
  {
    key: "costOfDelay" as const,
    label: "放置リスク",
    shortLabel: "放置",
    hint: "「今見なくてよいか」の主軸。高いほど先に見るべきです",
  },
  {
    key: "effort" as const,
    label: "介入コスト",
    shortLabel: "介入",
    hint: "短時間で済むか、重い介入か。高いほど手間がかかります",
  },
  {
    key: "blastRadius" as const,
    label: "影響半径",
    shortLabel: "影響",
    hint: "影響の広さ・粒度の違いを層分けします。高いほど影響が広いです",
  },
  {
    key: "confidence" as const,
    label: "確信度",
    shortLabel: "確信",
    hint: "判断材料の足り具合。低いときは今日の判断から外し、要情報へ回します",
  },
];

export function formatTriageAxis(value: number): string {
  return value.toFixed(2);
}

function AxisTooltip({
  label,
  hint,
  value,
  children,
  className,
}: {
  label: string;
  hint: string;
  value: string;
  children: ReactNode;
  className?: string;
}) {
  const tooltip = `${label} ${value}\n${hint}`;
  return (
    <span className={`${styles.axisTooltip} ${className ?? ""}`.trim()} data-tooltip={tooltip} tabIndex={0}>
      {children}
    </span>
  );
}

export function IssueTriageAxes({
  triage,
  compact = false,
}: {
  triage: Pick<IssueTriageScores, "costOfDelay" | "effort" | "blastRadius" | "confidence">;
  compact?: boolean;
}) {
  // 一覧の狭い列では「放置リ / スク 0.45」のように語の途中で折り返さないよう、
  // 軸ごとに nowrap のチップにし、折り返しはチップ単位だけにする。
  if (compact) {
    return (
      <div
        className={styles.issueTriageAxesCompact}
        role="group"
        aria-label="優先度評価の軸"
      >
        {TRIAGE_AXIS_META.map((a) => {
          const value = formatTriageAxis(triage[a.key]);
          return (
            <AxisTooltip key={a.key} label={a.label} hint={a.hint} value={value} className={styles.issueTriageAxisChip}>
              <span className={styles.issueTriageAxisLabel}>{a.shortLabel}</span>
              <span className={styles.issueTriageAxisValue}>{value}</span>
            </AxisTooltip>
          );
        })}
      </div>
    );
  }

  return (
    <div
      role="group"
      aria-label="優先度評価の軸"
      className={styles.issueTriageAxes}
    >
      {TRIAGE_AXIS_META.map((a) => {
        const value = formatTriageAxis(triage[a.key]);
        return (
          <AxisTooltip
            key={a.key}
            label={a.label}
            hint={a.hint}
            value={value}
            className={styles.issueStatusBadge}
          >
            <span style={{ fontSize: "0.75rem" }}>
              {a.label} {value}
            </span>
          </AxisTooltip>
        );
      })}
    </div>
  );
}

// 詳細画面からステータスを切り替えるボタン群。カンバンのドラッグ&ドロップは実装せず、
// 列間の移動はここから行う（スコープを抑えるための判断）。
export function IssueStatusSelector({
  status,
  onChange,
  disabled,
}: {
  status: IssueStatus;
  onChange: (status: IssueStatus) => void;
  disabled?: boolean;
}) {
  return (
    <div role="group" aria-label="ステータス" style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {ISSUE_STATUSES.map((s) => {
        const meta = ISSUE_STATUS_META[s];
        return (
          <button
            key={s}
            type="button"
            className={`${styles.typeChip} ${status === s ? styles.typeChipSelected : ""}`}
            disabled={disabled || status === s}
            onClick={() => onChange(s)}
          >
            {meta.icon} {meta.label}
          </button>
        );
      })}
    </div>
  );
}

export function IssuePrioritySelector({
  priority,
  onChange,
  disabled,
}: {
  priority: IssuePriority;
  onChange: (priority: IssuePriority) => void;
  disabled?: boolean;
}) {
  return (
    <div role="group" aria-label="優先度" style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {ISSUE_PRIORITIES.map((p) => {
        const meta = ISSUE_PRIORITY_META[p];
        return (
          <button
            key={p}
            type="button"
            className={`${styles.typeChip} ${priority === p ? styles.typeChipSelected : ""}`}
            disabled={disabled || priority === p}
            title={meta.hint}
            onClick={() => onChange(p)}
          >
            {meta.icon} {meta.label}
          </button>
        );
      })}
    </div>
  );
}
