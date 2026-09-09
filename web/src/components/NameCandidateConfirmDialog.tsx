"use client";

import styles from "@/app/page.module.css";

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
  const unique = [...new Set(candidates.map((c) => c.trim()).filter(Boolean))];

  return (
    <div className={styles.modalOverlay} role="dialog" aria-modal="true" aria-labelledby="name-candidate-title">
      <div className={styles.modalBox}>
        <div className={styles.modalHeader}>
          <h3 id="name-candidate-title" style={{ margin: 0, fontSize: "1.05rem" }}>
            マスクされない人名候補の確認
          </h3>
          <button type="button" className={styles.modalClose} onClick={onCancel} aria-label="閉じる" disabled={busy}>
            ×
          </button>
        </div>

        <p style={{ margin: "0 0 12px", fontSize: "0.9rem", lineHeight: 1.5 }}>
          次の語句が人名の可能性があり、マスクされずに残ります。人名として登録はせず、このまま進めてよいですか？後でAIが外部へ送信する可能性があります。
        </p>

        {unique.length === 0 ? (
          <p className={styles.errorText} role="alert" style={{ marginBottom: 16 }}>
            候補の詳細を表示できませんでした。キャンセルして再試行してください。
          </p>
        ) : (
          <ul style={{ margin: "0 0 16px", paddingLeft: "1.2rem", fontSize: "0.95rem", lineHeight: 1.6 }}>
            {unique.map((c) => (
              <li key={c} style={{ marginBottom: 4 }}>
                {c}
              </li>
            ))}
          </ul>
        )}

        <p style={{ margin: "0 0 16px", fontSize: "0.8rem", lineHeight: 1.5, color: "var(--text-muted)" }}>
          「このまま{actionLabel}」を選ぶと上記を人名登録せず未マスクのまま進めます。人名として扱いたい場合はキャンセルし、People
          や Journal の人物欄で登録してから再試行してください。
        </p>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" className={styles.btnOutline} onClick={onCancel} disabled={busy}>
            キャンセル
          </button>
          <button type="button" className={styles.primaryBtn} onClick={onAllow} disabled={busy || unique.length === 0}>
            {busy ? "処理中…" : `このまま${actionLabel}`}
          </button>
        </div>
      </div>
    </div>
  );
}
