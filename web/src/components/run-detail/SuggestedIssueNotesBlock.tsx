"use client";

import styles from "@/app/page.module.css";
import { IdLinkedText } from "@/components/IdLinkedText";
import { IdFragmentLink } from "@/components/IdFragmentLink";
import type { SuggestedIssueNote } from "@/components/RunDetail";

// docs/memo.md「Agentが相談などから他Issueなどへ記録することができない」対応。lookupで
// 見つけた別Issueへの追記提案。作成・ステータス変更は行わず、採用すると対象Issueの
// 経過ログ（IssueLogEntry）へ追記されるだけ（Human-in-the-Loopを維持）。
export function SuggestedIssueNotesBlock({
  notes,
  onAdopt,
  onDismiss,
  submitting,
}: {
  notes: SuggestedIssueNote[];
  onAdopt?: () => void;
  onDismiss?: () => void;
  submitting?: boolean;
}) {
  return (
    <div className={styles.yieldBlock} style={{ marginTop: 12 }}>
      <strong>📝 他Issueへの追記提案</strong>
      <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: 6 }}>
        このタスクとは別のIssueに関わる事実をAgentが見つけました。採用すると対象Issueの経過ログに追記されるだけで、
        作成・ステータス変更は行いません。
      </p>
      {notes.map((note, i) => (
        <div key={i} style={{ fontSize: "0.875rem", marginTop: 10, paddingTop: 8, borderTop: "1px solid var(--border)" }}>
          <strong>
            Issue:{" "}
            <IdFragmentLink fragment={note.issueId} className={styles.idFragmentLink}>
              {note.issueId.slice(0, 8)}
            </IdFragmentLink>
          </strong>
          <p style={{ margin: "4px 0" }}>
            <IdLinkedText text={note.text} />
          </p>
        </div>
      ))}
      <div className={styles.yieldActions}>
        <button className={styles.primaryBtn} style={{ width: "auto" }} disabled={submitting} onClick={() => onAdopt?.()}>
          採用して追記する
        </button>
        <button className={styles.btnOutline} disabled={submitting} onClick={onDismiss}>
          却下する
        </button>
      </div>
    </div>
  );
}
