import styles from "../../styles/page.module.css";
import { IdLinkedText } from "../IdLinkedText";
import { IdFragmentLink } from "../IdFragmentLink";
import type { SuggestedTheme } from "../RunDetail";

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
  return (
    <div className={styles.yieldBlock} style={{ marginTop: 12 }}>
      <strong>🧭 AIが提案するテーマ解釈（状況蒸留）</strong>
      <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: 6 }}>
        組織の上段課題の見立てです。採用すると今日タブの「現在の優先テーマ」になり、提案の壁打ちの前提に入ります。誤りや不足はチャットで壁打ちしてから再提案させるか、採用後に詳細から編集できます。
      </p>
      {themes.map((theme, i) => (
        <div key={i} style={{ fontSize: "0.75rem", marginTop: 10, paddingTop: 8, borderTop: "1px solid var(--border)" }}>
          <strong>
            <IdLinkedText text={theme.title} />
          </strong>
          <p style={{ margin: "4px 0" }}>
            <IdLinkedText text={theme.summary} />
          </p>
          <strong style={{ display: "block", marginTop: 4 }}>なぜこの結果に至ったか</strong>
          <p style={{ color: "var(--text-muted)", margin: "2px 0 4px" }}>
            <IdLinkedText text={theme.rationale} />
          </p>
          {theme.facts.length > 0 && (
            <ul style={{ margin: "4px 0 4px 16px" }}>
              {theme.facts.map((f, fi) => (
                <li key={fi}>
                  <IdLinkedText text={f} />
                </li>
              ))}
            </ul>
          )}
          {theme.rootCause && (
            <p style={{ margin: "4px 0" }}>
              <strong>根本原因: </strong>
              <IdLinkedText text={theme.rootCause} />
            </p>
          )}
          {theme.suggestedDirection && (
            <p style={{ margin: "4px 0" }}>
              <strong>解決の方向性: </strong>
              <IdLinkedText text={theme.suggestedDirection} />
            </p>
          )}
          {(theme.evidenceSuggestionIds?.length || theme.evidenceJournalIds?.length) ? (
            <div style={{ marginTop: 6 }}>
              {theme.evidenceSuggestionIds && theme.evidenceSuggestionIds.length > 0 && (
                <p style={{ margin: "2px 0" }}>
                  <strong>根拠 提案: </strong>
                  {theme.evidenceSuggestionIds.map((id, ii) => (
                    <span key={id}>
                      {ii > 0 ? "、" : ""}
                      <IdFragmentLink fragment={id} className={styles.idFragmentLink}>
                        {id.slice(0, 8)}
                      </IdFragmentLink>
                    </span>
                  ))}
                </p>
              )}
              {theme.evidenceJournalIds && theme.evidenceJournalIds.length > 0 && (
                <p style={{ margin: "2px 0" }}>
                  <strong>根拠 Journal: </strong>
                  {theme.evidenceJournalIds.map((id, ii) => (
                    <span key={id}>
                      {ii > 0 ? "、" : ""}
                      <IdFragmentLink fragment={id} className={styles.idFragmentLink}>
                        {id.slice(0, 8)}
                      </IdFragmentLink>
                    </span>
                  ))}
                </p>
              )}
            </div>
          ) : null}
        </div>
      ))}
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
    </div>
  );
}
