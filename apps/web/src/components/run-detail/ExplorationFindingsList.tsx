import { IdLinkedText } from "../IdLinkedText";
import styles from "../../styles/page.module.css";
import type { ExplorationFinding } from "@emther/core/agent-runtime";
import { explorationKindLabel } from "./exploration-labels";

/** 探索タブ内の観測ギャップ一覧。断定せず確認を促す表現で表示する。 */
export function ExplorationFindingsList({ findings }: { findings: ExplorationFinding[] }) {
  if (findings.length === 0) {
    return <p className={styles.subtitle}>まだ探索の示唆はありません。</p>;
  }

  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {findings.map((f, i) => (
        <li
          key={i}
          style={{
            marginBottom: 12,
            padding: "10px 12px",
            backgroundColor: "var(--surface)",
            borderRadius: 8,
            border: "1px solid var(--border)",
          }}
        >
          <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: 4 }}>
            {explorationKindLabel(f.kind)}
          </div>
          <p style={{ fontSize: "0.875rem", lineHeight: 1.55, margin: "0 0 6px" }}>
            <IdLinkedText text={f.observation} />
          </p>
          <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", lineHeight: 1.5, margin: 0 }}>
            関連性: <IdLinkedText text={f.relevance} />
          </p>
          {f.confirmationQuestion ? (
            <p style={{ fontSize: "0.875rem", lineHeight: 1.55, margin: "8px 0 0" }}>
              <strong style={{ fontSize: "0.8rem" }}>確認してみる価値がありそうなこと</strong>
              <br />
              <IdLinkedText text={f.confirmationQuestion} />
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
