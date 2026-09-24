import { Link } from "@/router";
import styles from "../styles/page.module.css";
import { consultExcerpt, truncateExcerpt } from "@emther/core/origin-trace";

export type OriginTraceJournal = {
  id: string;
  rawText: string;
  summary?: string;
};

export type OriginTraceConsult = {
  id: string;
  task: string;
  origin:
    | "manual"
    | "auto-anomaly"
    | "auto-summary"
    | "auto-suggestion-update"
    | "auto-distill"
    | "auto-grow"
    | "auto-journal-batch"
    | "auto-weekly-report"
    | "auto-monthly-report";
};

function originKindLabel(origin: OriginTraceConsult["origin"]): string | undefined {
  if (origin === "auto-anomaly") return "Journal自動分析";
  if (origin === "auto-summary") return "朝のサマリー";
  if (origin === "auto-suggestion-update") return "提案更新分析";
  if (origin === "auto-distill") return "状況蒸留";
  if (origin === "auto-grow") return "学びの提案";
  if (origin === "auto-journal-batch") return "Journal集約解釈";
  if (origin === "auto-weekly-report") return "週次レビュー";
  if (origin === "auto-monthly-report") return "月次レビュー";
  return undefined;
}

export function OriginTrace({
  journals = [],
  consult,
}: {
  journals?: OriginTraceJournal[];
  consult?: OriginTraceConsult | null;
}) {
  if (journals.length === 0 && !consult) return null;

  return (
    <aside className={styles.originTrace} aria-label="この項目が生まれたきっかけ">
      <p className={styles.originTraceTitle}>なぜ生まれたか</p>
      {journals.map((journal) => {
        const excerpt = truncateExcerpt(journal.summary || journal.rawText || "（本文なし）");
        return (
          <div key={journal.id || "journal-excerpt"} className={styles.originTraceItem}>
            <span className={styles.originTraceKind}>📝 Journal</span>
            <p className={styles.originTraceExcerpt}>{excerpt}</p>
            {journal.id && (
              <Link to={`/journal?focus=${encodeURIComponent(journal.id)}`} className={styles.originTraceLink}>
                Journalを開く
              </Link>
            )}
          </div>
        );
      })}
      {consult && (
        <div className={styles.originTraceItem}>
          <span className={styles.originTraceKind}>
            💬 相談{originKindLabel(consult.origin) ? `（${originKindLabel(consult.origin)}）` : ""}
          </span>
          <p className={styles.originTraceExcerpt}>{truncateExcerpt(consultExcerpt(consult.task) || "（内容なし）")}</p>
          <Link to={`/chat?runId=${encodeURIComponent(consult.id)}`} className={styles.originTraceLink}>
            相談を開く
          </Link>
        </div>
      )}
    </aside>
  );
}
