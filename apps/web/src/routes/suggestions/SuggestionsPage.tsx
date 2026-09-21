import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import styles from "../../styles/page.module.css";
import { PageTitleRow } from "../../components/HelpLink";
import { PaginationControls, usePagination } from "../../components/Pagination";
import { StatusBadge } from "../../components/RunDetail";
import { useSuggestionPeek } from "../../components/IdFragmentLink";
import {
  DEFAULT_SUGGESTION_STATUS_FILTER,
  SuggestionFilterBar,
  type SuggestionFilterState,
  type SuggestionSortKey,
} from "../../components/SuggestionFilterBar";
import {
  SUGGESTION_THEME_ALL,
  SUGGESTION_THEME_UNLINKED,
  SuggestionThemeSwitcher,
} from "../../components/SuggestionThemeSwitcher";
import { useRuns, useSettingsRules, useSuggestions, useThemes } from "../../lib/queries";
import {
  CONFIRM_PRIORITY_META,
  SUGGESTION_REVIEW_STATUS_META,
  compareSuggestionsByConfirmPriority,
  isRunStale,
  isSuggestionReviewOverdue,
  suggestionMatchesKeyword,
  type Suggestion,
} from "@emther/core/types";

const PAGE_SIZE = 8;

function formatRelativeDays(ts: number, now: number): string {
  const days = Math.floor((now - ts) / (24 * 60 * 60 * 1000));
  if (days <= 0) return "今日";
  if (days === 1) return "1日前";
  return `${days}日前`;
}

function matchesThemeFilter(s: Suggestion, themeKey: string): boolean {
  if (themeKey === SUGGESTION_THEME_ALL) return true;
  if (themeKey === SUGGESTION_THEME_UNLINKED) return !s.themeId;
  return s.themeId === themeKey;
}

function compareByDue(a: Suggestion, b: Suggestion, now: number): number {
  const aDue = a.reviewDueAt;
  const bDue = b.reviewDueAt;
  if (aDue == null && bDue == null) return compareSuggestionsByConfirmPriority(a, b);
  if (aDue == null) return 1;
  if (bDue == null) return -1;
  if (aDue !== bDue) return aDue - bDue;
  return compareSuggestionsByConfirmPriority(a, b);
}

function compareByUpdated(a: Suggestion, b: Suggestion): number {
  if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt;
  return compareSuggestionsByConfirmPriority(a, b);
}

function sortSuggestions(list: Suggestion[], sort: SuggestionSortKey, now: number): Suggestion[] {
  const next = list.slice();
  if (sort === "due") next.sort((a, b) => compareByDue(a, b, now));
  else if (sort === "updated") next.sort(compareByUpdated);
  else next.sort(compareSuggestionsByConfirmPriority);
  return next;
}

function UnlinkedRunsAsSuggestions({
  runs,
  suggestions,
  staleRunIds,
  onNavigateChat,
  onCreated,
}: {
  runs: { id: string; agentName: string; task: string; status: string; consultedBy?: string }[];
  suggestions: Suggestion[];
  staleRunIds: Set<string>;
  onNavigateChat: (runId: string) => void;
  onCreated: (id: string) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const unlinked = runs.filter((r) => !suggestions.some((s) => s.agentRunId === r.id));
  const page = usePagination(unlinked, 5);

  async function promote(run: (typeof unlinked)[0]) {
    if (run.agentName === "Lead Agent") {
      onNavigateChat(run.id);
      return;
    }
    setError(null);
    try {
      const res = await fetch("/api/suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: run.task.slice(0, 80), agentRunId: run.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "提案化に失敗しました");
      onCreated(data.suggestion.id);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className={styles.panel}>
      <h3 style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: "0 0 6px" }}>提案未作成の Agent Run</h3>
      <p className={styles.subtitle} style={{ marginBottom: 10 }}>
        Lead Agentは「何でも相談」へ。専門エージェントはクリックすると提案として残し、詳細へ移動します。
      </p>
      {error && (
        <p className={styles.errorText} role="alert">
          {error}
        </p>
      )}
      <div className={styles.runList} style={{ maxHeight: "none" }}>
        {unlinked.length === 0 && <p className={styles.subtitle}>すべての Run が提案に紐づいています。</p>}
        {page.pageItems.map((run) => (
          <button key={run.id} className={styles.runItem} onClick={() => void promote(run)}>
            <div>
              <strong>{run.agentName}</strong>{" "}
              <StatusBadge status={run.status as "idle"} stale={staleRunIds.has(run.id)} />
            </div>
            <div className={styles.runItemTask}>{run.task}</div>
          </button>
        ))}
      </div>
      <PaginationControls
        page={page.page}
        totalPages={page.totalPages}
        total={page.total}
        rangeStart={page.rangeStart}
        rangeEnd={page.rangeEnd}
        onChange={page.setPage}
      />
    </div>
  );
}

/**
 * docs/design/suggestion/suggestion-tab.pen 改善案C「テーマメニュー切替 + 段階開示」。
 * 長文テーマ向けのメニュー切替、検索／ソート／絞り込みチップ、4列表のフル幅一覧。
 */
export function SuggestionsPage() {
  const navigate = useNavigate();
  const peek = useSuggestionPeek();
  const { suggestions, suggestionsLoaded, refreshSuggestions } = useSuggestions();
  const { runs, refreshRuns } = useRuns();
  const { themes } = useThemes();
  const { rules } = useSettingsRules();
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const staleRunIds = useMemo(
    () => new Set(runs.filter((r) => isRunStale(r.status, r.updatedAt, rules.agentStaleAfterSeconds)).map((r) => r.id)),
    [runs, rules.agentStaleAfterSeconds],
  );

  const adoptedThemes = useMemo(
    () =>
      themes
        .filter((t) => t.status === "adopted")
        .sort((a, b) => (b.adoptedAt ?? b.updatedAt) - (a.adoptedAt ?? a.updatedAt)),
    [themes],
  );

  const [themeKey, setThemeKey] = useState(SUGGESTION_THEME_ALL);
  const [filters, setFilters] = useState<SuggestionFilterState>(() => ({
    query: "",
    sort: "due",
    statusFilter: new Set(DEFAULT_SUGGESTION_STATUS_FILTER),
    priorityFilter: new Set(),
    showDone: false,
    showArchived: false,
  }));
  const [focusMovingId, setFocusMovingId] = useState<string | null>(null);

  function handleFilterChange<K extends keyof SuggestionFilterState>(key: K, next: SuggestionFilterState[K]) {
    setFilters((prev) => ({ ...prev, [key]: next }));
  }

  function clearFilters() {
    setFilters((prev) => ({
      ...prev,
      statusFilter: new Set(),
      priorityFilter: new Set(),
      showDone: true,
      showArchived: false,
    }));
  }

  const themeCounts = useMemo(() => {
    const counts: Record<string, number> = {
      [SUGGESTION_THEME_ALL]: 0,
      [SUGGESTION_THEME_UNLINKED]: 0,
    };
    for (const t of adoptedThemes) counts[t.id] = 0;
    for (const s of suggestions) {
      if (s.archivedAt) continue;
      counts[SUGGESTION_THEME_ALL] += 1;
      if (!s.themeId) counts[SUGGESTION_THEME_UNLINKED] += 1;
      else if (counts[s.themeId] !== undefined) counts[s.themeId] += 1;
    }
    return counts;
  }, [suggestions, adoptedThemes]);

  const themeScoped = useMemo(
    () => suggestions.filter((s) => matchesThemeFilter(s, themeKey)),
    [suggestions, themeKey],
  );

  const statusSummary = useMemo(() => {
    const scope = themeScoped.filter((s) => !s.archivedAt);
    const unreviewed = scope.filter((s) => s.reviewStatus === "unreviewed").length;
    const inReview = scope.filter((s) => s.reviewStatus === "in_review").length;
    const overdue = scope.filter((s) => isSuggestionReviewOverdue(s, now)).length;
    return `未確認 ${unreviewed} · 確認中 ${inReview} · 期日超過 ${overdue}`;
  }, [themeScoped, now]);

  const filtered = useMemo(() => {
    const list = themeScoped
      .filter((s) => suggestionMatchesKeyword(s, filters.query))
      .filter((s) => {
        if (!filters.showArchived && s.archivedAt) return false;
        if (!filters.showDone && s.reviewStatus === "done") return false;
        if (filters.statusFilter.size > 0 && !filters.statusFilter.has(s.reviewStatus)) return false;
        return true;
      })
      .filter((s) => filters.priorityFilter.size === 0 || filters.priorityFilter.has(s.confirmPriority));
    return sortSuggestions(list, filters.sort, now);
  }, [themeScoped, filters, now]);

  const pagination = usePagination(filtered, PAGE_SIZE);
  const doneCount = suggestions.filter((s) => s.reviewStatus === "done").length;
  const archivedCount = suggestions.filter((s) => s.archivedAt).length;

  async function moveFocus(id: string, direction: "up" | "down") {
    setFocusMovingId(id);
    try {
      const res = await fetch(`/api/suggestions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ moveFocus: direction }),
      });
      if (res.ok) await refreshSuggestions();
    } finally {
      setFocusMovingId(null);
    }
  }

  return (
    <>
      <div className={styles.screen}>
        <div style={{ marginBottom: 12 }}>
          <PageTitleRow title="提案" helpAnchor="issues" />
          <p className={styles.journalTitleHint}>いま向き合うテーマを選び、その中の提案だけを確認・並び替える</p>
        </div>

        <SuggestionThemeSwitcher
          value={themeKey}
          onChange={setThemeKey}
          themes={adoptedThemes}
          counts={themeCounts}
          statusSummary={statusSummary}
        />

        <div className={styles.panel}>
          <SuggestionFilterBar
            value={filters}
            onChange={handleFilterChange}
            onClearFilters={clearFilters}
            doneCount={doneCount}
            archivedCount={archivedCount}
          />

          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>タイトル</th>
                  <th>確認状態</th>
                  <th>確認優先度</th>
                  <th>確認期日</th>
                </tr>
              </thead>
              <tbody>
                {pagination.total === 0 && (
                  <tr>
                    <td colSpan={4} className={styles.tableEmpty}>
                      {!suggestionsLoaded ? "読み込み中…" : "条件に一致する提案はありません。"}
                    </td>
                  </tr>
                )}
                {pagination.pageItems.map((s) => {
                  const linkedRun = runs.find((r) => r.id === s.agentRunId);
                  const statusMeta = SUGGESTION_REVIEW_STATUS_META[s.reviewStatus];
                  const priMeta = CONFIRM_PRIORITY_META[s.confirmPriority];
                  return (
                    <tr key={s.id}>
                      <td>
                        <button className={styles.tableRowLink} onClick={() => peek.open(s.id)}>
                          {s.title}
                        </button>
                        {now - s.updatedAt < 24 * 60 * 60 * 1000 && (
                          <span className={styles.newBadge} style={{ marginLeft: 6 }}>
                            NEW
                          </span>
                        )}
                        <div style={{ marginTop: 4, display: "flex", gap: 6, flexWrap: "wrap" }}>
                          {linkedRun && (
                            <StatusBadge status={linkedRun.status} stale={staleRunIds.has(linkedRun.id)} />
                          )}
                          {s.sourceJournalId && <span className={styles.tableMuted}>📝 Journalから</span>}
                          {s.sourceRunId && <span className={styles.tableMuted}>💬 相談から</span>}
                          {s.archivedAt && <span className={styles.tableMuted}>🗄 アーカイブ済み</span>}
                          <span className={styles.tableMuted}>{formatRelativeDays(s.updatedAt, now)}</span>
                        </div>
                      </td>
                      <td>
                        {statusMeta.icon} {statusMeta.label}
                      </td>
                      <td>
                        {priMeta.icon} {priMeta.label}
                        {s.confirmPriority === "focus" && (
                          <span style={{ marginLeft: 6 }}>
                            <button
                              type="button"
                              className={styles.btnOutline}
                              style={{ padding: "0 6px", fontSize: "0.75rem" }}
                              disabled={focusMovingId === s.id}
                              onClick={() => void moveFocus(s.id, "up")}
                            >
                              ↑
                            </button>{" "}
                            <button
                              type="button"
                              className={styles.btnOutline}
                              style={{ padding: "0 6px", fontSize: "0.75rem" }}
                              disabled={focusMovingId === s.id}
                              onClick={() => void moveFocus(s.id, "down")}
                            >
                              ↓
                            </button>
                          </span>
                        )}
                      </td>
                      <td className={isSuggestionReviewOverdue(s, now) ? styles.errorText : styles.tableMuted}>
                        {s.reviewDueAt
                          ? `${isSuggestionReviewOverdue(s, now) ? "⚠ " : ""}${new Date(s.reviewDueAt).toLocaleDateString("ja-JP")}まで`
                          : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <PaginationControls
            page={pagination.page}
            totalPages={pagination.totalPages}
            total={pagination.total}
            rangeStart={pagination.rangeStart}
            rangeEnd={pagination.rangeEnd}
            onChange={pagination.setPage}
          />
        </div>

        <UnlinkedRunsAsSuggestions
          runs={runs}
          suggestions={suggestions}
          staleRunIds={staleRunIds}
          onNavigateChat={(runId) => navigate(`/chat?runId=${runId}`)}
          onCreated={(id) => {
            void refreshSuggestions();
            void refreshRuns();
            peek.open(id);
          }}
        />
      </div>
    </>
  );
}
