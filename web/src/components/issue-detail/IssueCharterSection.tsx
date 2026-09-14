import styles from "@/app/page.module.css";
import { HelpLink } from "@/components/HelpLink";
import { MarkdownView } from "@/components/MarkdownView";
import { charterFilledCount, type Issue, type IssueCharter, type KnowledgeEvent } from "@/lib/types";

// docs/em_ui_ux_issue.md 7節対応。閲覧モードのWhy/What/Howのラベル。
const CHARTER_VIEW_FIELDS: { key: keyof IssueCharter; label: string }[] = [
  { key: "why", label: "Why（生む価値・誰のため・なぜ今か）" },
  { key: "what", label: "What（何を・どこまで・どのくらい・完了の定義）" },
  { key: "how", label: "How（どのように実現するか・前提や制約）" },
];

type Props = {
  issue: Issue;
  history: KnowledgeEvent[];
};

// docs/2nd_pivot_version.md Phase 2.4対応。Why/What/HowをEMが自分で手入れするUI
// （textareaでの自由入力・保存）は、Issueの構造を人間に手入れさせない方針と衝突するため
// 廃止した。今後Why/What/Howが埋まる経路は、AIが提案しEMが採用/却下する既存フロー
// （RunDetailのSuggestedCharterBlock→useIssueSuggestions.ts）のみ。ここは読み取り専用の
// 表示（既存Issueの記録・変更履歴の閲覧）に留める。
export function IssueCharterSection({ issue, history }: Props) {
  return (
    <div className={`${styles.panel} ${styles.charterSection}`} key={issue.id}>
      <div className={styles.pageTitleWithHelp} style={{ marginBottom: 10 }}>
        <h2 style={{ margin: 0 }}>Why / What / How</h2>
        <HelpLink anchor="issues" />
      </div>

      {charterFilledCount(issue.charter) < 3 && (
        <div className={styles.charterWarnBanner}>⚠️ {charterFilledCount(issue.charter)}/3 未整理</div>
      )}

      {CHARTER_VIEW_FIELDS.map(({ key, label }) => (
        <div key={key} className={styles.charterField}>
          <span className={styles.fieldCaption}>{label}</span>
          {issue.charter[key] ? (
            <MarkdownView text={issue.charter[key]} />
          ) : (
            <div className={styles.charterEmptyView}>未整理</div>
          )}
        </div>
      ))}

      {issue.tags.length > 0 && (
        <div className={styles.tagRow} style={{ marginBottom: 10 }}>
          {issue.tags.map((tag) => (
            <span key={tag} className={`${styles.tag} ${styles.tagTopic}`}>
              #{tag}
            </span>
          ))}
        </div>
      )}

      {history.length > 0 && (
        <details style={{ marginTop: 14 }}>
          <summary style={{ cursor: "pointer", fontSize: "0.75rem", color: "var(--text-muted)" }}>
            変更履歴（{history.length}件）
          </summary>
          <ul style={{ listStyle: "none", marginTop: 8 }}>
            {history.map((h) => (
              <li key={h.id} style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: 4 }}>
                {new Date(h.occurredAt).toLocaleString("ja-JP")} — {h.text}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
