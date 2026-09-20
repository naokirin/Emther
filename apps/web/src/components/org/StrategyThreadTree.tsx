import { useEffect, useState } from "react";
import { Link } from "react-router";
import styles from "../../styles/page.module.css";
import { SuggestionReviewStatusBadge } from "../IssueStatus";
import { SuggestionLink } from "../SuggestionLink";
import { truncateForTitle, type Issue, type JournalEntry, type ObjectiveWithProgress } from "@emther/core/types";

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
              <h3 className={styles.threadObjectiveTitle}>🎯 {o.title}</h3>
              <span className={styles.threadObjectiveMeta}>
                {o.keyResults.length} KR ・ {totalIssues} 提案 {isOpen ? "▾" : "▸"}
              </span>
            </div>
            {isOpen && (
              <>
                {o.keyResults.length === 0 && (
                  <p className={styles.threadEmptyHint} style={{ marginLeft: 18 }}>
                    KeyResultが未登録です。
                  </p>
                )}
                {o.keyResults.map((kr) => {
                  const progress = o.progress.find((p) => p.keyResultId === kr.id);
                  const krIssues = issuesForKeyResult(issues, kr.id);
                  return (
                    <div key={kr.id} className={styles.threadKr}>
                      <div className={styles.threadKrHeader}>
                        <span className={styles.threadKrTitle}>📈 {kr.title}</span>
                        <span className={styles.tableMuted} style={{ flexShrink: 0 }}>
                          提案 {progress?.total ?? 0}件
                        </span>
                      </div>
                      {krIssues.length === 0 ? (
                        <p className={styles.threadEmptyHint}>このKey Resultに紐づく提案はまだありません。</p>
                      ) : (
                        krIssues.map((issue) => {
                          const journals = journalsForIssue(journalEntries, issue);
                          return (
                            <div key={issue.id} className={styles.threadIssue}>
                              <div className={styles.threadIssueHeader}>
                                <SuggestionLink
                                  id={issue.id}
                                  className={`${styles.tableRowLink} ${styles.threadIssueTitle}`}
                                  style={{ display: "inline", width: "auto" }}
                                >
                                  🗂 {issue.title}
                                </SuggestionLink>
                                <SuggestionReviewStatusBadge status={issue.reviewStatus} />
                              </div>
                              {journals.length === 0 ? (
                                <p className={styles.threadEmptyHint}>この提案に紐づくJournalはまだありません。</p>
                              ) : (
                                <>
                                  {journals.slice(0, JOURNAL_PER_ISSUE_LIMIT).map((j) => (
                                    <div key={j.id} className={styles.threadJournal}>
                                      <Link
                                        to={`/journal?focus=${encodeURIComponent(j.id)}`}
                                        className={styles.tableRowLink}
                                        style={{ display: "inline", width: "auto" }}
                                      >
                                        📝 {truncateForTitle(j.summary || j.rawText || "（本文なし）", 60)}
                                      </Link>
                                    </div>
                                  ))}
                                  {journals.length > JOURNAL_PER_ISSUE_LIMIT && (
                                    <p className={styles.threadJournal}>他 {journals.length - JOURNAL_PER_ISSUE_LIMIT} 件</p>
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
