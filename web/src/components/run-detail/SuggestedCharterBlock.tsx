"use client";

import styles from "@/app/page.module.css";
import { IdLinkedText } from "@/components/IdLinkedText";

const CHARTER_FIELD_LABEL: Record<"why" | "what" | "how", string> = {
  why: "Why（生む価値・誰のため・なぜ今か）",
  what: "What（何を・どこまで・どのくらい・完了の定義）",
  how: "How（どのように実現するか・前提や制約）",
};

export function SuggestedCharterBlock({
  charter,
  onAdopt,
  onDismiss,
  submitting,
}: {
  charter: { why?: string; what?: string; how?: string };
  onAdopt?: (charter: { why?: string; what?: string; how?: string }) => void;
  onDismiss?: () => void;
  submitting?: boolean;
}) {
  return (
    <div className={styles.yieldBlock} style={{ marginTop: 12 }}>
      <strong>📝 AIが提案するWhy/What/How</strong>
      <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: 6 }}>
        未整理だった項目の埋め合わせ案です。採用すると、この項目だけIssueのWhy/What/Howに反映されます（既に書かれている項目は上書きしません）。
      </p>
      {(["why", "what", "how"] as const).map(
        (key) =>
          charter[key] && (
            <div key={key} style={{ fontSize: "0.75rem", marginTop: 6 }}>
              <strong>{CHARTER_FIELD_LABEL[key]}</strong>
              <p style={{ margin: "2px 0 0" }}>
                <IdLinkedText text={charter[key]!} />
              </p>
            </div>
          ),
      )}
      <div className={styles.yieldActions}>
        <button
          className={styles.primaryBtn}
          style={{ width: "auto" }}
          disabled={submitting}
          onClick={() => onAdopt?.(charter)}
        >
          採用してWhy/What/Howに反映
        </button>
        <button className={styles.btnOutline} disabled={submitting} onClick={onDismiss}>
          却下する
        </button>
      </div>
    </div>
  );
}
