"use client";

import { useState } from "react";
import Link from "next/link";
import styles from "@/app/page.module.css";
import { StatusBadge, type AgentRun } from "@/components/RunDetail";
import { PaginationControls, type usePagination } from "@/components/Pagination";
import { ProgressBar } from "@/components/ProgressBar";
import { IssueStatusBadge, IssuePriorityBadge, IssueTriageAxes } from "@/components/IssueStatus";
import {
  INTERVENTION_TYPES,
  ISSUE_PRIORITY_META,
  charterFilledCount,
  compareIssuesByPriority,
  isIssueStalled,
  isIssueStrategyUnlinked,
  issueNextAction,
  issueOverviewText,
  issueProgress,
  type Issue,
  type ObjectiveWithProgress,
  type OrgTheme,
  type Team,
} from "@/lib/types";

// docs/em_human_story_and_ux.md P1-7対応。介入の型はtagsの中の1つとして保存されているだけ
// なので、他の（自由記入の）タグと見た目で区別できるよう、INTERVENTION_TYPESに含まれる
// ラベルかどうかで判定する。
const INTERVENTION_TYPE_LABELS = new Set(INTERVENTION_TYPES.map((t) => t.label));

function formatRelativeDays(ts: number, now: number): string {
  const days = Math.floor((now - ts) / (24 * 60 * 60 * 1000));
  if (days <= 0) return "今日";
  if (days === 1) return "1日前";
  return `${days}日前`;
}

// docs/memo.md「Issue等で期限管理ができない」対応。一覧では期限そのものと、
// 過ぎている場合の強調だけを見せる（ロードマップ画面は別スコープ）。
function formatDueDate(dueAt: number): string {
  const d = new Date(dueAt);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function DueBadge({ issue, now }: { issue: Pick<Issue, "dueAt" | "status">; now: number }) {
  if (issue.dueAt === undefined) return null;
  const overdue = issue.status !== "done" && issue.dueAt < now;
  return (
    <span className={styles.tableMuted} style={overdue ? { color: "var(--warning, #b45309)" } : undefined}>
      {overdue ? "⚠ " : "📅 "}期限 {formatDueDate(issue.dueAt)}
    </span>
  );
}

type Props = {
  issuesPagination: ReturnType<typeof usePagination<Issue>>;
  issuesLoaded: boolean;
  issues: Issue[];
  runs: AgentRun[];
  teams: Team[];
  themes: OrgTheme[];
  objectives: ObjectiveWithProgress[];
  staleRunIds: Set<string>;
  now: number;
  staleInterventionDays: number;
  showArchived: boolean;
  matchesIssueFilters: (i: Issue) => boolean;
  refreshIssues: () => Promise<void> | void;
  onPeekOpen: (id: string) => void;
};

// Issue一覧のメインテーブル（リストビュー）。親Issue行＋展開時の子Issue行、
// フォーカス順の並び替え、ページネーションを持つ。
export function IssueListTable({
  issuesPagination,
  issuesLoaded,
  issues,
  runs,
  teams,
  themes,
  objectives,
  staleRunIds,
  now,
  staleInterventionDays,
  showArchived,
  matchesIssueFilters,
  refreshIssues,
  onPeekOpen,
}: Props) {
  // リスト: 親ごとの子Issue展開。既定は折りたたみ。
  const [expandedIssueIds, setExpandedIssueIds] = useState<Set<string>>(() => new Set());
  const [focusMovingId, setFocusMovingId] = useState<string | null>(null);

  function toggleIssueExpanded(issueId: string) {
    setExpandedIssueIds((prev) => {
      const next = new Set(prev);
      if (next.has(issueId)) next.delete(issueId);
      else next.add(issueId);
      return next;
    });
  }

  // docs/em_human_story_and_ux.md P1-7対応。「今期何を解いているか」を一覧でも見せるための
  // Objective/KRタイトルの逆引き。
  function resolveKeyResult(krId: string): { objectiveId: string; label: string } | undefined {
    for (const o of objectives) {
      const kr = o.keyResults.find((k) => k.id === krId);
      if (kr) return { objectiveId: o.id, label: `${o.title} ＞ ${kr.title}` };
    }
    return undefined;
  }

  async function handleMoveFocus(issueId: string, direction: "up" | "down") {
    setFocusMovingId(issueId);
    try {
      const res = await fetch(`/api/issues/${issueId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ moveFocus: direction }),
      });
      if (res.ok) await refreshIssues();
    } finally {
      setFocusMovingId(null);
    }
  }

  return (
    <>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>タイトル</th>
              <th>ステータス</th>
              <th>優先度/判断</th>
              <th>次の一手</th>
              <th>型・関連</th>
              <th>Why/What/How</th>
              <th>進捗</th>
              <th>最終判断</th>
            </tr>
          </thead>
          <tbody>
            {issuesPagination.total === 0 && (
              <tr>
                <td colSpan={8} className={styles.tableEmpty}>
                  {!issuesLoaded ? "読み込み中…" : "条件に一致するIssueはありません。"}
                </td>
              </tr>
            )}
            {issuesPagination.pageItems.flatMap((issue) => {
              const linkedRun = runs.find((r) => r.id === issue.agentRunId);
              const childIssuesOfRow = issues.filter((i) => i.parentId === issue.id);
              const expandableChildren = childIssuesOfRow.filter((c) => showArchived || !c.archived);
              const visibleChildren = expandableChildren.filter(matchesIssueFilters).slice().sort(compareIssuesByPriority);
              const charterCount = charterFilledCount(issue.charter);
              const childCount = expandableChildren.length;
              const progress = issueProgress(issue, childIssuesOfRow);
              const stalled = isIssueStalled(issue, now, staleInterventionDays);
              const interventionTypes = issue.tags.filter((t) => INTERVENTION_TYPE_LABELS.has(t));
              const topicTags = issue.tags.filter((t) => !INTERVENTION_TYPE_LABELS.has(t));
              const teamName = issue.teamId ? teams.find((t) => t.id === issue.teamId)?.name : undefined;
              const themeTitle = issue.themeId ? themes.find((t) => t.id === issue.themeId)?.title : undefined;
              const krRef = issue.keyResultId ? resolveKeyResult(issue.keyResultId) : undefined;
              const strategyUnlinked = isIssueStrategyUnlinked(issue);
              const nextAction = issueNextAction(issue);
              const priority = issue.priority ?? "normal";
              const expanded = expandedIssueIds.has(issue.id);

              const parentRow = (
                <tr key={issue.id} style={issue.archived ? { opacity: 0.6 } : undefined}>
                  <td>
                    <div className={styles.issueTitleCell}>
                      {childCount > 0 ? (
                        <button
                          type="button"
                          className={styles.issueTreeToggle}
                          aria-expanded={expanded}
                          aria-label={expanded ? "子Issueを折りたたむ" : "子Issueを展開する"}
                          onClick={() => toggleIssueExpanded(issue.id)}
                        >
                          {expanded ? "▼" : "▶"}
                        </button>
                      ) : (
                        <span className={styles.issueTreeToggleSpacer} aria-hidden />
                      )}
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <button
                          className={`${styles.tableRowLink} ${styles.axisTooltip}`}
                          data-tooltip={issueOverviewText(issue.charter)}
                          onClick={() => onPeekOpen(issue.id)}
                        >
                          {issue.title}
                        </button>
                        <div style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                          {linkedRun && <StatusBadge status={linkedRun.status} stale={staleRunIds.has(linkedRun.id)} />}
                          {issue.archived && <span className={styles.tableMuted}>🗄 アーカイブ済み</span>}
                          {childCount > 0 && (
                            <span className={styles.tableMuted}>
                              🧩 子Issue: {childCount}件
                              {expanded && visibleChildren.length !== childCount ? `（表示 ${visibleChildren.length}）` : ""}
                            </span>
                          )}
                          {stalled && <span className={styles.tableMuted}>⏳ 停滞中</span>}
                          {issue.sourceJournalId && <span className={styles.tableMuted}>📝 Journalから</span>}
                          {issue.sourceRunId && <span className={styles.tableMuted}>💬 相談から</span>}
                          <DueBadge issue={issue} now={now} />
                        </div>
                        {topicTags.length > 0 && (
                          <div className={styles.tagRow} style={{ marginTop: 4 }}>
                            {topicTags.map((tag) => (
                              <span key={tag} className={`${styles.tag} ${styles.tagTopic}`}>
                                #{tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td>
                    <IssueStatusBadge status={issue.status} />
                  </td>
                  <td>
                    <IssuePriorityBadge priority={priority} />
                    {issue.triage && <IssueTriageAxes triage={issue.triage} compact />}
                    {issue.triage?.suggestedPriority &&
                      issue.triage.suggestedPriority !== priority && (
                        <div
                          className={styles.tableMuted}
                          style={{ marginTop: 4, color: "var(--warning, #b45309)", fontSize: "0.7rem" }}
                          title="評価上の提案と、いまの優先度が違います（手動変更の可能性）"
                        >
                          提案: {ISSUE_PRIORITY_META[issue.triage.suggestedPriority].icon}{" "}
                          {ISSUE_PRIORITY_META[issue.triage.suggestedPriority].label}
                        </div>
                      )}
                    {priority === "focus" && (
                      <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
                        <button
                          type="button"
                          className={styles.btnOutline}
                          style={{ fontSize: "0.7rem", padding: "1px 6px" }}
                          disabled={focusMovingId === issue.id}
                          onClick={() => handleMoveFocus(issue.id, "up")}
                          title="フォーカス順を前へ"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className={styles.btnOutline}
                          style={{ fontSize: "0.7rem", padding: "1px 6px" }}
                          disabled={focusMovingId === issue.id}
                          onClick={() => handleMoveFocus(issue.id, "down")}
                          title="フォーカス順を後へ"
                        >
                          ↓
                        </button>
                      </div>
                    )}
                  </td>
                  <td className={styles.tableMuted} style={{ maxWidth: 220 }}>
                    {nextAction ? (
                      <span title={nextAction.text}>{nextAction.text.length > 48 ? `${nextAction.text.slice(0, 48)}…` : nextAction.text}</span>
                    ) : (
                      <span style={{ opacity: 0.7 }}>未設定</span>
                    )}
                  </td>
                  {/* docs/em_human_story_and_ux.md P1-7対応。型・関連チーム・今期のKRを一覧の時点で
                      見せ、「実装タスク箱」ではなく「介入のポートフォリオ」として読めるようにする。 */}
                  <td>
                    {interventionTypes.map((t) => (
                      <div key={t} style={{ marginBottom: 4 }}>
                        <span className={`${styles.tag} ${styles.tagPerson}`}>🎯 {t}</span>
                      </div>
                    ))}
                    {teamName && (
                      <div className={styles.tableMuted} title="関連チーム">
                        👥 {teamName}
                      </div>
                    )}
                    {themeTitle && issue.themeId && (
                      <div className={styles.tableMuted} title="紐付いているテーマ">
                        🎯{" "}
                        <Link
                          href={`/?theme=${encodeURIComponent(issue.themeId)}`}
                          className={styles.tableRowLink}
                          style={{ display: "inline", width: "auto", fontWeight: 500 }}
                        >
                          {themeTitle}
                        </Link>
                      </div>
                    )}
                    {krRef && (
                      <div className={styles.tableMuted} title="紐付いているKey Result">
                        📈{" "}
                        <Link
                          href={`/org?objective=${encodeURIComponent(krRef.objectiveId)}`}
                          className={styles.tableRowLink}
                          style={{ display: "inline", width: "auto", fontWeight: 500 }}
                        >
                          {krRef.label}
                        </Link>
                      </div>
                    )}
                    {strategyUnlinked && (
                      <div className={styles.tableMuted} title="テーマ / Key Result 未接続" style={{ color: "var(--warning, #b45309)" }}>
                        ⚠ 戦略未接続
                      </div>
                    )}
                  </td>
                  <td>
                    <span className={charterCount === 3 ? styles.charterBadgeReady : styles.charterBadgeWarn}>
                      {charterCount === 3 ? "✅" : "❓"} {charterCount}/3
                    </span>
                  </td>
                  <td>
                    <ProgressBar done={progress.done} total={progress.total} />
                  </td>
                  <td className={styles.tableMuted} title="最終更新日">
                    {formatRelativeDays(issue.updatedAt, now)}
                  </td>
                </tr>
              );

              if (!expanded || visibleChildren.length === 0) return [parentRow];

              const childRows = visibleChildren.map((child) => {
                const childLinkedRun = runs.find((r) => r.id === child.agentRunId);
                const childCharterCount = charterFilledCount(child.charter);
                const childProgress = issueProgress(child, []);
                const childInterventionTypes = child.tags.filter((t) => INTERVENTION_TYPE_LABELS.has(t));
                const childTopicTags = child.tags.filter((t) => !INTERVENTION_TYPE_LABELS.has(t));
                const childTeamName = child.teamId ? teams.find((t) => t.id === child.teamId)?.name : undefined;
                const childThemeTitle = child.themeId ? themes.find((t) => t.id === child.themeId)?.title : undefined;
                const childKrRef = child.keyResultId ? resolveKeyResult(child.keyResultId) : undefined;
                const childNextAction = issueNextAction(child);
                const childPriority = child.priority ?? "normal";
                return (
                  <tr
                    key={child.id}
                    className={styles.issueChildRow}
                    style={child.archived ? { opacity: 0.6 } : undefined}
                  >
                    <td>
                      <div className={styles.issueTitleCell}>
                        <span className={styles.issueTreeToggleSpacer} aria-hidden />
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <button
                            className={`${styles.tableRowLink} ${styles.axisTooltip}`}
                            data-tooltip={issueOverviewText(child.charter)}
                            onClick={() => onPeekOpen(child.id)}
                          >
                            {child.title}
                          </button>
                          <div style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                            <span className={styles.tableMuted}>↳ {issue.title}</span>
                            {childLinkedRun && (
                              <StatusBadge status={childLinkedRun.status} stale={staleRunIds.has(childLinkedRun.id)} />
                            )}
                            {child.archived && <span className={styles.tableMuted}>🗄 アーカイブ済み</span>}
                            {child.sourceJournalId && <span className={styles.tableMuted}>📝 Journalから</span>}
                            {child.sourceRunId && <span className={styles.tableMuted}>💬 相談から</span>}
                            <DueBadge issue={child} now={now} />
                          </div>
                          {childTopicTags.length > 0 && (
                            <div className={styles.tagRow} style={{ marginTop: 4 }}>
                              {childTopicTags.map((tag) => (
                                <span key={tag} className={`${styles.tag} ${styles.tagTopic}`}>
                                  #{tag}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td>
                      <IssueStatusBadge status={child.status} />
                    </td>
                    <td>
                      <IssuePriorityBadge priority={childPriority} />
                    </td>
                    <td className={styles.tableMuted} style={{ maxWidth: 220 }}>
                      {childNextAction ? (
                        <span title={childNextAction.text}>
                          {childNextAction.text.length > 48 ? `${childNextAction.text.slice(0, 48)}…` : childNextAction.text}
                        </span>
                      ) : (
                        <span style={{ opacity: 0.7 }}>未設定</span>
                      )}
                    </td>
                    <td>
                      {childInterventionTypes.map((t) => (
                        <div key={t} style={{ marginBottom: 4 }}>
                          <span className={`${styles.tag} ${styles.tagPerson}`}>🎯 {t}</span>
                        </div>
                      ))}
                      {childTeamName && (
                        <div className={styles.tableMuted} title="関連チーム">
                          👥 {childTeamName}
                        </div>
                      )}
                      {childThemeTitle && child.themeId && (
                        <div className={styles.tableMuted} title="紐付いているテーマ">
                          🎯{" "}
                          <Link
                            href={`/?theme=${encodeURIComponent(child.themeId)}`}
                            className={styles.tableRowLink}
                            style={{ display: "inline", width: "auto", fontWeight: 500 }}
                          >
                            {childThemeTitle}
                          </Link>
                        </div>
                      )}
                      {childKrRef && (
                        <div className={styles.tableMuted} title="紐付いているKey Result">
                          📈{" "}
                          <Link
                            href={`/org?objective=${encodeURIComponent(childKrRef.objectiveId)}`}
                            className={styles.tableRowLink}
                            style={{ display: "inline", width: "auto", fontWeight: 500 }}
                          >
                            {childKrRef.label}
                          </Link>
                        </div>
                      )}
                    </td>
                    <td>
                      <span className={childCharterCount === 3 ? styles.charterBadgeReady : styles.charterBadgeWarn}>
                        {childCharterCount === 3 ? "✅" : "❓"} {childCharterCount}/3
                      </span>
                    </td>
                    <td>
                      <ProgressBar done={childProgress.done} total={childProgress.total} />
                    </td>
                    <td className={styles.tableMuted} title="最終更新日">
                      {formatRelativeDays(child.updatedAt, now)}
                    </td>
                  </tr>
                );
              });

              return [parentRow, ...childRows];
            })}
          </tbody>
        </table>
      </div>
      <PaginationControls
        page={issuesPagination.page}
        totalPages={issuesPagination.totalPages}
        total={issuesPagination.total}
        rangeStart={issuesPagination.rangeStart}
        rangeEnd={issuesPagination.rangeEnd}
        onChange={issuesPagination.setPage}
      />
    </>
  );
}
