"use client";

import styles from "@/app/page.module.css";
import { IdLinkedText } from "@/components/IdLinkedText";

export function SuggestedActionItemsBlock({
  items,
  onAdopt,
  onDismiss,
  submitting,
}: {
  items: string[];
  onAdopt?: (items: string[]) => void;
  onDismiss?: () => void;
  submitting?: boolean;
}) {
  return (
    <div className={styles.yieldBlock} style={{ marginTop: 12 }}>
      <strong>💡 AIが提案するAction Items</strong>
      <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: 6 }}>
        採用すると先頭の1件が「次の一手」、残りは「あとでやる」に入ります。
      </p>
      <ul style={{ margin: "6px 0 8px 18px", fontSize: "0.75rem" }}>
        {items.map((item, i) => (
          <li key={i}>
            {i === 0 ? <strong>次の一手: </strong> : null}
            <IdLinkedText text={item} />
          </li>
        ))}
      </ul>
      <div className={styles.yieldActions}>
        <button
          className={styles.primaryBtn}
          style={{ width: "auto" }}
          disabled={submitting}
          onClick={() => onAdopt?.(items)}
        >
          採用する（先頭を次の一手に）
        </button>
        <button className={styles.btnOutline} disabled={submitting} onClick={onDismiss}>
          却下する
        </button>
      </div>
    </div>
  );
}
