"use client";

import styles from "@/app/page.module.css";
import { ProgressBar } from "@/components/ProgressBar";
import { ISSUE_STATUSES, ISSUE_STATUS_META, isIssueStalled, issueProgress, type Issue } from "@/lib/types";

// docs/em_ui_ux_issue.md 4節「ビューの切り替え機能」対応。ステータス4列のカンバン。
// ドラッグ&ドロップは実装しない（列間の移動は詳細画面のステータス切り替えボタンから行う。
// スコープとリスクを抑えるための判断）。
export function IssueBoard({
  issues,
  allIssues,
  now,
  staleInterventionDays,
  onSelect,
}: {
  issues: Issue[];
  allIssues: Issue[];
  now: number;
  staleInterventionDays: number;
  onSelect: (id: string) => void;
}) {
  return (
    <div className={styles.board}>
      {ISSUE_STATUSES.map((status) => {
        const meta = ISSUE_STATUS_META[status];
        const columnIssues = issues.filter((i) => i.status === status);
        return (
          <div key={status} className={styles.boardColumn}>
            <div className={styles.boardColumnHeader}>
              <span>
                {meta.icon} {meta.label}
              </span>
              <span className={styles.tableMuted}>{columnIssues.length}件</span>
            </div>
            {columnIssues.length === 0 && <p className={styles.subtitle}>なし</p>}
            {columnIssues.map((issue) => {
              const childIssues = allIssues.filter((i) => i.parentId === issue.id);
              const progress = issueProgress(issue, childIssues);
              const stalled = isIssueStalled(issue, now, staleInterventionDays);
              return (
                <button key={issue.id} type="button" className={styles.boardCard} onClick={() => onSelect(issue.id)}>
                  <div className={styles.boardCardTitle}>{issue.title}</div>
                  <ProgressBar done={progress.done} total={progress.total} />
                  <div className={styles.boardCardMeta}>
                    {issue.archived && <span className={styles.tableMuted}>🗄 アーカイブ済み</span>}
                    {stalled && <span className={styles.tableMuted}>⏳ 停滞中</span>}
                  </div>
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
