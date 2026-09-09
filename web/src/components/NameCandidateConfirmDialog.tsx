"use client";

import styles from "@/app/page.module.css";
import { NAME_CANDIDATE_CONFIRMATION_MESSAGE } from "@/lib/name-candidate-confirmation";

export function NameCandidateConfirmDialog({
  candidates,
  actionLabel,
  busy,
  onAllow,
  onCancel,
}: {
  candidates: string[];
  /** 例: 「保存する」「送信する」 */
  actionLabel: string;
  busy?: boolean;
  onAllow: () => void;
  onCancel: () => void;
}) {
  return (
    <div className={styles.modalOverlay} role="dialog" aria-modal="true" aria-labelledby="name-candidate-title">
      <div className={styles.modalBox}>
        <div className={styles.modalHeader}>
          <h3 id="name-candidate-title" style={{ margin: 0, fontSize: "1.05rem" }}>
            未登録の人名候補
          </h3>
          <button type="button" className={styles.modalClose} onClick={onCancel} aria-label="閉じる" disabled={busy}>
            ×
          </button>
        </div>
        <p style={{ margin: "0 0 12px", fontSize: "0.9rem", lineHeight: 1.5 }}>
          {NAME_CANDIDATE_CONFIRMATION_MESSAGE}
        </p>
        <ul style={{ margin: "0 0 16px", paddingLeft: "1.2rem", fontSize: "0.95rem" }}>
          {candidates.map((c) => (
            <li key={c}>
              <code>{c}</code>
            </li>
          ))}
        </ul>
        <p style={{ margin: "0 0 16px", fontSize: "0.8rem", color: "var(--text-muted)" }}>
          「このまま{actionLabel}」を選ぶと人名としては登録せず、未マスクのまま進めます。人名として扱いたい場合はキャンセルし、People
          や Journal の人物欄で登録してから再試行してください。
        </p>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" className={styles.btnOutline} onClick={onCancel} disabled={busy}>
            キャンセル
          </button>
          <button type="button" className={styles.primaryBtn} onClick={onAllow} disabled={busy}>
            {busy ? "処理中…" : `このまま${actionLabel}`}
          </button>
        </div>
      </div>
    </div>
  );
}
