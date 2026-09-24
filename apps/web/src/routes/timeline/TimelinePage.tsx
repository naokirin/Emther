import { Link } from "@/router";
import styles from "../../styles/page.module.css";
import { IdResolveProvider } from "../../components/IdFragmentLink";
import { PageTitleRow } from "../../components/HelpLink";
import { SlideOver } from "../../components/SlideOver";
import { usePeekParam } from "../../lib/usePeekParam";
import { useTimeline } from "../../lib/queries";
import { SuggestionDetailContent } from "../../components/SuggestionDetailContent";
import { TIMELINE_ENTITY_TYPE_LABEL, type TimelineEntry } from "@emther/core/types";

// react-routerのusePeekParam
// （../lib/usePeekParam）はSuspenseを要求しないため、元実装の<Suspense>ラッパーは不要
// （削除した）

function groupByDate(entries: TimelineEntry[]): { date: string; items: TimelineEntry[] }[] {
  const groups: { date: string; items: TimelineEntry[] }[] = [];
  for (const entry of entries) {
    const date = new Date(entry.occurredAt).toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric", weekday: "short" });
    const last = groups[groups.length - 1];
    if (last && last.date === date) {
      last.items.push(entry);
    } else {
      groups.push({ date, items: [entry] });
    }
  }
  return groups;
}

export function TimelinePage() {
  const { entries, timelineLoaded } = useTimeline();
  const groups = groupByDate(entries);
  // 一覧・詳細の他画面と同じ仕組みでスライドオーバー表示にする。Team/Goalは
  // Goal は /org で詳細を開ける。Team は /teams?focus=
  const peek = usePeekParam("suggestion");
  const peekedEntry = peek.id ? entries.find((e) => e.entityType === "suggestion" && e.entityId === peek.id) : undefined;

  return (
    <IdResolveProvider openSuggestionInPeek={peek.open}>
      <div className={styles.screen}>
        <PageTitleRow title="タイムライン" helpAnchor="reflection" />
        <div className={styles.panel}>
          {groups.length === 0 ? (
            <p className={styles.subtitle}>
              {!timelineLoaded
                ? "読み込み中…"
                : "まだ変更履歴はありません。提案の起票やチーム編集などを行うとここに記録されます。"}
            </p>
          ) : (
            groups.map((group) => (
              <div key={group.date} style={{ marginTop: 18 }}>
                <h3 style={{ fontSize: "0.875rem", marginBottom: 6 }}>{group.date}</h3>
                <ul style={{ listStyle: "none" }}>
                  {group.items.map((entry) => (
                    <li key={entry.id} className={styles.field} style={{ marginBottom: 16, paddingBottom: 12, borderBottom: "1px solid var(--border)" }}>
                      <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                        <span className={styles.badge}>{TIMELINE_ENTITY_TYPE_LABEL[entry.entityType]}</span>
                        {entry.entityType === "suggestion" && entry.entityId ? (
                          <button
                            type="button"
                            className={styles.tableRowLink}
                            style={{ fontWeight: 600 }}
                            onClick={() => peek.open(entry.entityId!)}
                          >
                            {entry.entityLabel ?? "(削除済み)"}
                          </button>
                        ) : entry.href ? (
                          <Link to={entry.href} style={{ fontWeight: 600 }}>
                            {entry.entityLabel ?? "(削除済み)"}
                          </Link>
                        ) : (
                          <strong>{entry.entityLabel ?? "(削除済み)"}</strong>
                        )}
                        <span className={styles.subtitle}>
                          {new Date(entry.occurredAt).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                      <div style={{ fontSize: "0.875rem", marginTop: 4 }}>{entry.text}</div>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </div>

        {peekedEntry && peek.id && (
          <SlideOver title={peekedEntry.entityLabel ?? "提案"} detailHref={`/suggestions/${peek.id}`} onClose={peek.close}>
            <SuggestionDetailContent id={peek.id} />
          </SlideOver>
        )}
      </div>
    </IdResolveProvider>
  );
}
