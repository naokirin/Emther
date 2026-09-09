"use client";

import styles from "@/app/page.module.css";

export type NameCandidateDecision = "allow" | "register";

export function NameCandidateConfirmDialog({
  candidates,
  actionLabel,
  busy,
  onAllow,
  onRegister,
  onCancel,
}: {
  candidates: string[];
  /** 例: 「保存する」「送信する」 */
  actionLabel: string;
  busy?: boolean;
  onAllow: () => void;
  /** 候補を人名として登録してから進める */
  onRegister: () => void;
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
          次の語句が人名の可能性があり、このままではマスクされずに残ります。人名として登録するか、未マスクのまま進めるか選んでください。後でAIが外部へ送信する可能性があります。
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
          「人名として登録して{actionLabel}」は People に登録しマスクして進めます。「このまま{actionLabel}」は登録せず未マスクのまま進めます。
        </p>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
          <button type="button" className={styles.btnOutline} onClick={onCancel} disabled={busy}>
            キャンセル
          </button>
          <button type="button" className={styles.btnOutline} onClick={onAllow} disabled={busy || unique.length === 0}>
            {busy ? "処理中…" : `このまま${actionLabel}`}
          </button>
          <button type="button" className={styles.primaryBtn} onClick={onRegister} disabled={busy || unique.length === 0}>
            {busy ? "処理中…" : `人名として登録して${actionLabel}`}
          </button>
        </div>
      </div>
    </div>
  );
}
