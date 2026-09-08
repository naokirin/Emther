"use client";

import styles from "@/app/page.module.css";

// docs/em_ui_ux_issue.md 4節「進捗の視覚化」対応。Action Items・サブIssueの完了数から
// 出す進捗を、一覧・詳細・カンバンで共通のバーとして表示する。total:0は「未完了」ではなく
// 「まだ項目が無い」ことを明示する（Team Vitalsの評価不能と同じ思想）。
export function ProgressBar({ done, total }: { done: number; total: number }) {
  if (total === 0) {
    return <span className={styles.tableMuted}>項目なし</span>;
  }
  const ratio = Math.min(1, done / total);
  return (
    <div className={styles.progressBarRow}>
      <div className={styles.progressBar} role="progressbar" aria-valuenow={done} aria-valuemin={0} aria-valuemax={total}>
        <div className={styles.progressBarFill} style={{ width: `${Math.round(ratio * 100)}%` }} />
      </div>
      <span className={styles.progressBarLabel}>
        {done}/{total}
      </span>
    </div>
  );
}
