import { useState } from "react";
import styles from "../../styles/page.module.css";
import { IdLinkedText } from "../IdLinkedText";
import type { SuggestedTheme } from "@emther/core/agent-runtime";
import { ThemeReader } from "./ThemeReader";

export function SuggestedThemesBlock({
  themes,
  onAdopt,
  onDismiss,
  submitting,
  onFocusChat,
}: {
  themes: SuggestedTheme[];
  onAdopt?: () => void;
  onDismiss?: () => void;
  submitting?: boolean;
  onFocusChat: () => void;
}) {
  const [readerIndex, setReaderIndex] = useState<number | null>(null);

  return (
    <div className={styles.yieldBlock} style={{ marginTop: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <strong>🧭 AIが提案するテーマ解釈（状況蒸留）</strong>
        <button
          type="button"
          className={styles.btnOutline}
          style={{ width: "auto", fontSize: "0.8125rem" }}
          onClick={() => setReaderIndex(0)}
        >
          全文を開く
        </button>
      </div>
      <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: 6 }}>
        組織の上段課題の見立てです。採用すると今日タブの「現在の優先テーマ」になり、提案の壁打ちの前提に入ります。詳細は全文から確認できます。
      </p>
      <ol style={{ margin: "10px 0 0", padding: "0 0 0 18px" }}>
        {themes.map((theme, i) => (
          <li key={i} style={{ marginBottom: 8 }}>
            <button
              type="button"
              onClick={() => setReaderIndex(i)}
              style={{
                background: "none",
                border: "none",
                padding: 0,
                textAlign: "left",
                cursor: "pointer",
                color: "var(--accent, #2563eb)",
                fontSize: "0.9375rem",
                fontWeight: 600,
                lineHeight: 1.4,
              }}
            >
              <IdLinkedText text={theme.title} />
            </button>
            <p style={{ margin: "4px 0 0", fontSize: "0.8125rem", color: "var(--text-muted)", lineHeight: 1.5 }}>
              <IdLinkedText text={theme.summary} />
            </p>
          </li>
        ))}
      </ol>
      <div className={styles.yieldActions}>
        <button className={styles.primaryBtn} style={{ width: "auto" }} disabled={submitting} onClick={() => onAdopt?.()}>
          採用してテーマにする
        </button>
        <button className={styles.btnOutline} disabled={submitting} onClick={onDismiss}>
          却下する
        </button>
        <button className={styles.btnOutline} onClick={onFocusChat}>
          壁打ちで訂正する
        </button>
      </div>
      {readerIndex !== null && (
        <ThemeReader themes={themes} initialIndex={readerIndex} onClose={() => setReaderIndex(null)} />
      )}
    </div>
  );
}
