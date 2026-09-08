"use client";

import styles from "@/app/page.module.css";
import { ISSUE_STATUSES, ISSUE_STATUS_META, type IssueStatus } from "@/lib/types";

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
