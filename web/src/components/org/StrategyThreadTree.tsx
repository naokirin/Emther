"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import styles from "@/app/page.module.css";
import { IssueStatusBadge } from "@/components/IssueStatus";
import { ProgressBar } from "@/components/ProgressBar";
import { truncateForTitle, type Issue, type JournalEntry, type ObjectiveWithProgress } from "@/lib/types";

const JOURNAL_PER_ISSUE_LIMIT = 3;

type Props = {
  objectives: ObjectiveWithProgress[];
  objectivesLoaded: boolean;
  issues: Issue[];
  journalEntries: JournalEntry[];
  focusObjectiveId: string | null;
};

function issuesForKeyResult(issues: Issue[], keyResultId: string): Issue[] {
  return issues.filter((i) => i.keyResultId === keyResultId);
}

// docs/memo.md「戦略→Issue→Journalの縦の接続が見えづらい」対応。OrgTheme.evidence*（作成時
// 一度きりのAIスナップショット）は使わず、Issue.sourceJournalId／JournalEntry.resolvedIssueId
// というライブな外部キーから都度組み立てる（新しいJournalが後から紐づいても反映される）。
function journalsForIssue(journalEntries: JournalEntry[], issue: Issue): JournalEntry[] {
  const ids = new Set<string>();
  if (issue.sourceJournalId) ids.add(issue.sourceJournalId);
  for (const j of journalEntries) {
    if (j.resolvedIssueId === issue.id) ids.add(j.id);
  }
  return journalEntries.filter((j) => ids.has(j.id)).sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * 「方針・目標」タブの閲覧専用サブタブ（/org/thread）本体。Objective › KeyResult › Issue ›
 * Journal をライブクエリで組み立てたツリーとして一望できるようにする。編集は一切行わない
 * （編集は/orgのまま。ここに機能を足して肥大化させないための明示的な役割分担）。
 */
export function StrategyThreadTree({ objectives, objectivesLoaded, issues, journalEntries, focusObjectiveId }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [appliedFocusId, setAppliedFocusId] = useState<string | null>(null);

  if (
    objectivesLoaded &&
    focusObjectiveId &&
    focusObjectiveId !== appliedFocusId &&
    objectives.some((o) => o.id === focusObjectiveId)
  ) {
    setAppliedFocusId(focusObjectiveId);
    setExpanded((prev) => new Set(prev).add(focusObjectiveId));
  }

  useEffect(() => {
    if (!focusObjectiveId || focusObjectiveId !== appliedFocusId) return;
    const el = document.querySelector(`[data-objective-id="${CSS.escape(focusObjectiveId)}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [focusObjectiveId, appliedFocusId]);

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (!objectivesLoaded) return <p className={styles.subtitle}>読み込み中…</p>;
  if (objectives.length === 0) {
    return <p className={styles.emptyState}>Objectiveがまだ登録されていません。方針・目標タブから追加してください。</p>;
  }

  return (
    <div className={styles.threadTree}>
      {objectives.map((o) => {
        const isOpen = expanded.has(o.id);
        const totalIssues = o.keyResults.reduce((n, kr) => n + issuesForKeyResult(issues, kr.id).length, 0);
        return (
          <div key={o.id} className={styles.threadObjective} data-objective-id={o.id}>
            <div
              className={styles.threadObjectiveHeader}
              role="button"
              tabIndex={0}
              onClick={() => toggle(o.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  toggle(o.id);
                }
              }}
            >
              <strong>🎯 {o.title}</strong>
              <span className={styles.subtitle} style={{ margin: 0 }}>
                {o.keyResults.length} KR ・ {totalIssues} Issue {isOpen ? "▾" : "▸"}
              </span>
            </div>
            {isOpen && (
              <>
                {o.keyResults.length === 0 && (
                  <p className={styles.subtitle} style={{ marginLeft: 18 }}>
                    KeyResultが未登録です。
                  </p>
                )}
                {o.keyResults.map((kr) => {
                  const progress = o.progress.find((p) => p.keyResultId === kr.id);
                  const krIssues = issuesForKeyResult(issues, kr.id);
                  return (
                    <div key={kr.id} className={styles.threadKr}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                        <span>📈 {kr.title}</span>
                        <div style={{ maxWidth: 160, flexShrink: 0 }}>
                          <ProgressBar done={progress?.done ?? 0} total={progress?.total ?? 0} />
                        </div>
                      </div>
                      {krIssues.length === 0 ? (
                        <p className={styles.subtitle} style={{ margin: "4px 0 0" }}>
                          このKey Resultに紐づくIssueはまだありません。
                        </p>
                      ) : (
                        krIssues.map((issue) => {
                          const journals = journalsForIssue(journalEntries, issue);
                          return (
                            <div key={issue.id} className={styles.threadIssue}>
                              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                                <Link
                                  href={`/issues/${issue.id}`}
                                  className={styles.tableRowLink}
                                  style={{ display: "inline", width: "auto" }}
                                >
                                  🗂 {issue.title}
                                </Link>
                                <IssueStatusBadge status={issue.status} />
                              </div>
                              {journals.length === 0 ? (
                                <p className={styles.subtitle} style={{ margin: "2px 0 0" }}>
                                  このIssueに紐づくJournalはまだありません。
                                </p>
                              ) : (
                                <>
                                  {journals.slice(0, JOURNAL_PER_ISSUE_LIMIT).map((j) => (
                                    <div key={j.id} className={styles.threadJournal}>
                                      <Link
                                        href={`/journal?focus=${encodeURIComponent(j.id)}`}
                                        className={styles.tableRowLink}
                                        style={{ display: "inline", width: "auto" }}
                                      >
                                        📝 {truncateForTitle(j.summary || j.rawText || "（本文なし）", 60)}
                                      </Link>
                                    </div>
                                  ))}
                                  {journals.length > JOURNAL_PER_ISSUE_LIMIT && (
                                    <p className={styles.threadJournal} style={{ margin: "2px 0 0" }}>
                                      他 {journals.length - JOURNAL_PER_ISSUE_LIMIT} 件
                                    </p>
                                  )}
                                </>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                  );
                })}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
