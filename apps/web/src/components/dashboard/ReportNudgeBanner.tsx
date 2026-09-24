import { useState } from "react";
import styles from "../../styles/page.module.css";
import {
  markReportPeriodSeen,
  type ReportNudge,
} from "../../lib/report-nudge";

type Props = {
  primary: ReportNudge | null;
  secondary: ReportNudge | null;
  onOpenReport: (runId: string) => void;
};

// 週次・月次レポートの弱い案内帯
export function ReportNudgeBanner({ primary, secondary, onOpenReport }: Props) {
  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(() => new Set());

  if (!primary) return null;
  const primaryKey = `${primary.kind}:${primary.periodKey}`;
  if (hiddenKeys.has(primaryKey)) return null;

  function dismiss(nudge: ReportNudge) {
    markReportPeriodSeen(nudge.kind, nudge.periodKey);
    setHiddenKeys((prev) => new Set(prev).add(`${nudge.kind}:${nudge.periodKey}`));
  }

  const secondaryKey = secondary ? `${secondary.kind}:${secondary.periodKey}` : null;
  const showSecondary = secondary && secondaryKey && !hiddenKeys.has(secondaryKey);

  return (
    <div className={styles.reportNudgeStack}>
      <div className={styles.reportNudgeBanner}>
        <div className={styles.reportNudgeBannerBody}>
          <span className={styles.reportNudgeEyebrow}>{primary.eyebrow}</span>
          <span className={styles.reportNudgeText}>{primary.body}</span>
          <button
            type="button"
            className={styles.reportNudgeLink}
            onClick={() => {
              dismiss(primary);
              onOpenReport(primary.runId);
            }}
          >
            {primary.linkLabel}
          </button>
        </div>
        <button
          type="button"
          className={styles.reportNudgeDismiss}
          aria-label="この案内を閉じる"
          onClick={() => dismiss(primary)}
        >
          ×
        </button>
      </div>
      {showSecondary && secondary && (
        <div className={`${styles.reportNudgeBanner} ${styles.reportNudgeBannerThin}`}>
          <div className={styles.reportNudgeBannerBody}>
            <span className={styles.reportNudgeEyebrow}>{secondary.eyebrow}</span>
            <span className={styles.reportNudgeText}>{secondary.body}</span>
            <button
              type="button"
              className={styles.reportNudgeLink}
              onClick={() => {
                dismiss(secondary);
                onOpenReport(secondary.runId);
              }}
            >
              {secondary.linkLabel}
            </button>
          </div>
          <button
            type="button"
            className={styles.reportNudgeDismiss}
            aria-label="月次案内を閉じる"
            onClick={() => dismiss(secondary)}
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}
