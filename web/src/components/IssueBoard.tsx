"use client";

import styles from "@/app/page.module.css";
import { ProgressBar } from "@/components/ProgressBar";
import { ISSUE_STATUSES, ISSUE_STATUS_META, isIssueStalled, issueProgress, type Issue, type IssueStatus } from "@/lib/types";

// デザイン見直し（frontend-design）対応。列の上端をステータス色にする（notStartedは
// 既定のグレー枠のままなので modifier クラスを持たない）。
const COLUMN_ACCENT_CLS: Record<IssueStatus, string> = {
  not_started: "",
  in_progress: styles.inProgress,
  blocked: styles.blocked,
  done: styles.done,
};

// docs/em_ui_ux_issue.md 4節「ビューの切り替え機能」対応。ステータス4列のカンバン。
// ドラッグ&ドロップは実装しない（列間の移動は詳細画面のステータス切り替えボタンから行う。
// スコープとリスクを抑えるための判断）。
// 子Issueを含める場合は親と同様に自身の status 列へ独立カードとして並べる（親カード配下へのネストではない）。
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
          <div key={status} className={`${styles.boardColumn} ${COLUMN_ACCENT_CLS[status]}`}>
            <div className={styles.boardColumnHeader}>
              <span>
                {meta.icon} {meta.label}
              </span>
              <span className={styles.boardColumnCount}>{columnIssues.length}件</span>
            </div>
            {columnIssues.length === 0 && <p className={styles.subtitle}>なし</p>}
            {columnIssues.map((issue) => {
              const childIssues = issue.parentId ? [] : allIssues.filter((i) => i.parentId === issue.id);
              const progress = issueProgress(issue, childIssues);
              const stalled = isIssueStalled(issue, now, staleInterventionDays);
              const parent = issue.parentId ? allIssues.find((i) => i.id === issue.parentId) : undefined;
              return (
                <button key={issue.id} type="button" className={styles.boardCard} onClick={() => onSelect(issue.id)}>
                  <div className={styles.boardCardTitle}>{issue.title}</div>
                  <ProgressBar done={progress.done} total={progress.total} />
                  <div className={styles.boardCardMeta}>
                    {parent && <span className={styles.tableMuted}>↳ {parent.title}</span>}
                    {!issue.parentId && childIssues.length > 0 && (
                      <span className={styles.tableMuted}>🧩 子Issue: {childIssues.length}件</span>
                    )}
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
