"use client";

import styles from "@/app/page.module.css";
import { ISSUE_PRIORITY_META, type IssuePriority } from "@/lib/types";

export function SuggestedPriorityBlock({
  priority,
  onAdopt,
  onDismiss,
  submitting,
}: {
  priority: IssuePriority;
  onAdopt?: (priority: IssuePriority) => void;
  onDismiss?: () => void;
  submitting?: boolean;
}) {
  return (
    <div className={styles.yieldBlock} style={{ marginTop: 12 }}>
      <strong>🔥 AIが提案する優先度</strong>
      <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: 6 }}>
        今週〜今月の介入ポートフォリオ上の位置づけです。採用するとIssueの優先度に反映されます。
      </p>
      <p style={{ fontSize: "0.875rem", marginTop: 6 }}>
        {ISSUE_PRIORITY_META[priority].icon} {ISSUE_PRIORITY_META[priority].label}
        <span style={{ color: "var(--text-muted)", marginLeft: 8 }}>
          — {ISSUE_PRIORITY_META[priority].hint}
        </span>
      </p>
      <div className={styles.yieldActions}>
        <button
          className={styles.primaryBtn}
          style={{ width: "auto" }}
          disabled={submitting}
          onClick={() => onAdopt?.(priority)}
        >
          採用して優先度に反映
        </button>
        <button className={styles.btnOutline} disabled={submitting} onClick={onDismiss}>
          却下する
        </button>
      </div>
    </div>
  );
}
