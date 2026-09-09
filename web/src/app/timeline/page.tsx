"use client";

import { Suspense } from "react";
import Link from "next/link";
import styles from "@/app/page.module.css";
import { IssueDetailContent } from "@/components/IssueDetailContent";
import { SlideOver } from "@/components/SlideOver";
import { usePeekParam, useTimeline } from "@/lib/hooks";
import { TIMELINE_ENTITY_TYPE_LABEL, type TimelineEntry } from "@/lib/types";

// docs/memo.md「N. 時系列変化をEMが読む物語に」対応。新しい永続化エンティティは持たず、
// 既存のIssue/Team/Objectiveの変更履歴（KnowledgeEvent）を横断して日付ごとにまとめ、
// 「昨日と今日で組織理解がどう変わったか」を読める物語として見せるだけの画面。
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

export default function TimelinePage() {
  // usePeekParamはuseSearchParamsを使うため<Suspense>で包む必要がある。
  return (
    <Suspense fallback={null}>
      <TimelinePageInner />
    </Suspense>
  );
}

function TimelinePageInner() {
  const { entries, timelineLoaded } = useTimeline();
  const groups = groupByDate(entries);
  // docs/em_ui_ux_issue.md「一覧⇄詳細をサイドピークで」対応。TimelineのIssueエントリだけ、
  // 一覧・詳細の他画面と同じ仕組みでスライドオーバー表示にする。Team/Objectiveは
  // /org側が個別エンティティのURL・詳細ビューを持たないため対象外（従来通り/orgへ遷移）。
  const peek = usePeekParam("issue");
  const peekedEntry = peek.id ? entries.find((e) => e.entityType === "issue" && e.entityId === peek.id) : undefined;

  return (
    <div className={styles.screen}>
      <div className={styles.panel}>
        <h2>Timeline</h2>
        <p className={styles.subtitle} style={{ marginBottom: 4 }}>
          Issue・Team・Objectiveの変更履歴を横断した時系列です。「組織の状態そのものがどう変わったか」を追えます。
        </p>
        <p className={styles.subtitle} style={{ marginBottom: 12 }}>🗓 週次の儀式でOK。毎日見る必要はありません。</p>
        {groups.length === 0 ? (
          <p className={styles.subtitle}>
            {!timelineLoaded
              ? "読み込み中…"
              : "まだ変更履歴はありません。Issueの起票やチーム編集などを行うとここに記録されます。"}
          </p>
        ) : (
          groups.map((group) => (
            <div key={group.date} style={{ marginTop: 18 }}>
              <h3 style={{ fontSize: "0.8125rem", marginBottom: 6 }}>{group.date}</h3>
              <ul style={{ listStyle: "none" }}>
                {group.items.map((entry) => (
                  <li key={entry.id} className={styles.field} style={{ marginBottom: 16, paddingBottom: 12, borderBottom: "1px solid var(--border)" }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                      <span className={styles.badge}>{TIMELINE_ENTITY_TYPE_LABEL[entry.entityType]}</span>
                      {entry.entityType === "issue" && entry.entityId ? (
                        <button
                          type="button"
                          className={styles.tableRowLink}
                          style={{ fontWeight: 600 }}
                          onClick={() => peek.open(entry.entityId!)}
                        >
                          {entry.entityLabel ?? "(削除済み)"}
                        </button>
                      ) : entry.href ? (
                        <Link href={entry.href} style={{ fontWeight: 600 }}>
                          {entry.entityLabel ?? "(削除済み)"}
                        </Link>
                      ) : (
                        <strong>{entry.entityLabel ?? "(削除済み)"}</strong>
                      )}
                      <span className={styles.subtitle}>
                        {new Date(entry.occurredAt).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                    <div style={{ fontSize: "0.8125rem", marginTop: 4 }}>{entry.text}</div>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </div>

      {peekedEntry && peek.id && (
        <SlideOver title={peekedEntry.entityLabel ?? "Issue"} detailHref={`/issues/${peek.id}`} onClose={peek.close}>
          <IssueDetailContent id={peek.id} />
        </SlideOver>
      )}
    </div>
  );
}
