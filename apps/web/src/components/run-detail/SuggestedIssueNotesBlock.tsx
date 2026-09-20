import { useState } from "react";
import styles from "../../styles/page.module.css";
import { IdLinkedText } from "../IdLinkedText";
import { IdFragmentLink } from "../IdFragmentLink";
import type { SuggestedIssueNote } from "../RunDetail";

// docs/memo.md「Agentが相談などから他Issueなどへ記録することができない」対応。lookupで
// 見つけた別Issueへの追記提案。採用すると対象Issueの経過ログ（IssueLogEntry）へ追記されるだけで、
// 作成・ステータス変更は行わない。
// docs/memo.md「他Issueへの追記提案で追記対象を個別に選択できるようにする」「却下だけでなく
// 対応済みも」対応。複数件あるときはチェックで対象を絞り込め、却下（提案自体が誤り）と
// 対応済み（別口ですでに対応済みなので追わない）を区別できる。
export function SuggestedIssueNotesBlock({
  notes,
  onAdopt,
  onDismiss,
  onMarkHandled,
  submitting,
}: {
  notes: SuggestedIssueNote[];
  onAdopt?: (indices: number[]) => void;
  onDismiss?: (indices: number[]) => void;
  onMarkHandled?: (indices: number[]) => void;
  submitting?: boolean;
}) {
  const [selected, setSelected] = useState<Set<number>>(() => new Set(notes.map((_, i) => i)));

  function toggle(i: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  const selectedIndices = notes.map((_, i) => i).filter((i) => selected.has(i));
  const hasSelection = selectedIndices.length > 0;

  return (
    <div className={styles.yieldBlock} style={{ marginTop: 12 }}>
      <strong>📝 他の提案への追記提案</strong>
      <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: 6 }}>
        このタスクとは別の提案に関わる事実をAgentが見つけました。採用すると対象の提案の経過ログに追記されるだけで、
        作成・ステータス変更は行いません。
        {notes.length > 1 ? "チェックで対象を選べます（未選択のものは提案のまま残ります）。" : ""}
      </p>
      {notes.map((note, i) => (
        <label
          key={i}
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 8,
            fontSize: "0.875rem",
            marginTop: 10,
            paddingTop: 8,
            borderTop: "1px solid var(--border)",
          }}
        >
          <input
            type="checkbox"
            checked={selected.has(i)}
            onChange={() => toggle(i)}
            style={{ marginTop: 3 }}
          />
          <span>
            <strong>
              提案:{" "}
              <IdFragmentLink fragment={note.issueId} className={styles.idFragmentLink}>
                {note.issueId.slice(0, 8)}
              </IdFragmentLink>
            </strong>
            <p style={{ margin: "4px 0" }}>
              <IdLinkedText text={note.text} />
            </p>
          </span>
        </label>
      ))}
      <div className={styles.yieldActions}>
        <button
          className={styles.primaryBtn}
          style={{ width: "auto" }}
          disabled={submitting || !hasSelection}
          onClick={() => onAdopt?.(selectedIndices)}
        >
          採用して追記する
        </button>
        <button
          className={`${styles.btnOutline} ${styles.axisTooltip}`}
          disabled={submitting || !hasSelection}
          onClick={() => onMarkHandled?.(selectedIndices)}
          data-tooltip="すでに別口で対応済みなので、これ以上追いかけない"
        >
          対応済みにする
        </button>
        <button className={styles.btnOutline} disabled={submitting || !hasSelection} onClick={() => onDismiss?.(selectedIndices)}>
          却下する
        </button>
      </div>
    </div>
  );
}
