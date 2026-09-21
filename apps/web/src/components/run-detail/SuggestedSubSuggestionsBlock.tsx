import styles from "../../styles/page.module.css";
import { IdLinkedText } from "../IdLinkedText";
import { CONFIRM_PRIORITY_META } from "@emther/core/types";
import type { SuggestedSubSuggestion } from "../RunDetail";

export function SuggestedSubSuggestionsBlock({
  items,
  onAdopt,
  onDismiss,
  submitting,
}: {
  items: SuggestedSubSuggestion[];
  onAdopt?: (items: SuggestedSubSuggestion[]) => void;
  onDismiss?: () => void;
  submitting?: boolean;
}) {
  return (
    <div className={styles.yieldBlock} style={{ marginTop: 12 }}>
      <strong>🔭 AIが提案する分解案（子提案）</strong>
      <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: 6 }}>
        独自の Why/What/How を持つ別の介入として切り出す案です。この介入の「次の一手」なら Action Item のままにしてください。採用すると実際に子提案が作成されます（優先度も一緒に反映）。
      </p>
      <ul style={{ margin: "6px 0 8px 18px", fontSize: "0.75rem" }}>
        {items.map((item, i) => {
          const p = item.priority ? CONFIRM_PRIORITY_META[item.priority] : undefined;
          return (
            <li key={i}>
              <IdLinkedText text={item.title} />
              {p ? (
                <span style={{ color: "var(--text-muted)", marginLeft: 6 }}>
                  {p.icon} {p.label}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
      <div className={styles.yieldActions}>
        <button
          className={styles.primaryBtn}
          style={{ width: "auto" }}
          disabled={submitting}
          onClick={() => onAdopt?.(items)}
        >
          採用して子提案を作成
        </button>
        <button className={styles.btnOutline} disabled={submitting} onClick={onDismiss}>
          却下する
        </button>
      </div>
    </div>
  );
}
