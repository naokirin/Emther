import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import styles from "../../styles/page.module.css";
import { PageTitleRow } from "../../components/HelpLink";
import { PaginationControls } from "../../components/Pagination";
import { usePagination } from "../../components/usePagination";
import { StatusBadge } from "../../components/RunDetail";
import { useSuggestionPeek } from "../../components/useSuggestionPeek";
import { SuggestionFilterBar } from "../../components/SuggestionFilterBar";
import {
  DEFAULT_SUGGESTION_STATUS_FILTER,
  type SuggestionFilterState,
  type SuggestionSortKey,
} from "../../components/suggestionFilter";
import {
  SUGGESTION_THEME_ALL,
  SUGGESTION_THEME_UNLINKED,
  SuggestionThemeSwitcher,
} from "../../components/SuggestionThemeSwitcher";
import {
  useSuggestionExportColumns,
} from "../../components/SuggestionExportColumnEditor";
import { SuggestionExportMenu } from "../../components/SuggestionExportMenu";
import { useRuns, useSettingsRules, useSuggestions, useTeams, useThemes } from "../../lib/queries";
import { copyTextToClipboard } from "../../lib/clipboard";
import { downloadTextFile, suggestionExportFileName } from "../../lib/downloadTextFile";
import {
  formatSuggestionsCsv,
  formatSuggestionsMarkdownBundle,
  formatSuggestionsMarkdownTable,
  formatSuggestionsTsv,
  agentSourceFromRun,
} from "@emther/core/suggestion-export";
import { resolveSourceConsultRun } from "@emther/core/origin-trace";
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

function compareByDue(a: Suggestion, b: Suggestion): number {
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

function sortSuggestions(list: Suggestion[], sort: SuggestionSortKey): Suggestion[] {
  const next = list.slice();
  if (sort === "due") next.sort(compareByDue);
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
  const { teams } = useTeams();
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

  const exportLookups = useMemo(() => {
    const agentSourceBySuggestionId: Record<string, ReturnType<typeof agentSourceFromRun>> = {};
    for (const s of suggestions) {
      const linkedRun = s.agentRunId ? runs.find((r) => r.id === s.agentRunId) : undefined;
      const sourceConsult = resolveSourceConsultRun(
        { sourceRunId: s.sourceRunId, agentRunId: s.agentRunId },
        runs,
      );
      const activeRun = linkedRun ?? sourceConsult;
      if (!activeRun) continue;
      agentSourceBySuggestionId[s.id] = agentSourceFromRun(
        activeRun,
        !linkedRun && sourceConsult ? "元の相談" : "判断・提案（Agent）",
      );
    }
    return {
      themeTitleById: Object.fromEntries(themes.map((t) => [t.id, t.title])),
      teamNameById: Object.fromEntries(teams.map((t) => [t.id, t.name])),
      appOrigin: typeof window !== "undefined" ? window.location.origin : undefined,
      agentSourceBySuggestionId,
    };
  }, [themes, teams, suggestions, runs]);

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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const { columnIds, setColumnIds } = useSuggestionExportColumns();

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
    return sortSuggestions(list, filters.sort);
  }, [themeScoped, filters]);

  const pagination = usePagination(filtered, PAGE_SIZE);
  const doneCount = suggestions.filter((s) => s.reviewStatus === "done").length;
  const archivedCount = suggestions.filter((s) => s.archivedAt).length;

  const exportTargets = useMemo(() => {
    if (selectedIds.size === 0) return filtered;
    return filtered.filter((s) => selectedIds.has(s.id));
  }, [filtered, selectedIds]);

  const pageIds = pagination.pageItems.map((s) => s.id);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectPage() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allPageSelected) {
        for (const id of pageIds) next.delete(id);
      } else {
        for (const id of pageIds) next.add(id);
      }
      return next;
    });
  }

  function selectAllFiltered() {
    setSelectedIds(new Set(filtered.map((s) => s.id)));
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  async function copyExport(kind: "tsv" | "md") {
    if (exportTargets.length === 0) {
      setCopyFeedback("コピーする提案がありません");
      window.setTimeout(() => setCopyFeedback(null), 2000);
      return;
    }
    const text =
      kind === "tsv"
        ? formatSuggestionsTsv(exportTargets, columnIds, exportLookups)
        : formatSuggestionsMarkdownTable(exportTargets, columnIds, exportLookups);
    const ok = await copyTextToClipboard(text);
    setCopyFeedback(ok ? `${exportTargets.length}件をコピーしました` : "コピーに失敗しました");
    window.setTimeout(() => setCopyFeedback(null), 2000);
  }

  function downloadExport(kind: "csv" | "md") {
    if (exportTargets.length === 0) {
      setCopyFeedback("出力する提案がありません");
      window.setTimeout(() => setCopyFeedback(null), 2000);
      return;
    }
    const fileName = suggestionExportFileName(kind);
    let ok: boolean;
    if (kind === "csv") {
      // Excel が UTF-8 を認識しやすいよう BOM 付き
      const body = "\uFEFF" + formatSuggestionsCsv(exportTargets, columnIds, exportLookups);
      ok = downloadTextFile(fileName, body, "text/csv;charset=utf-8");
    } else {
      const body = formatSuggestionsMarkdownBundle(exportTargets, exportLookups);
      ok = downloadTextFile(fileName, body, "text/markdown;charset=utf-8");
    }
    setCopyFeedback(ok ? `${exportTargets.length}件を ${fileName} に保存しました` : "ファイル出力に失敗しました");
    window.setTimeout(() => setCopyFeedback(null), 2500);
  }

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
            trailing={
              <SuggestionExportMenu
                selectedCount={selectedIds.size}
                filteredCount={filtered.length}
                columnIds={columnIds}
                onColumnIdsChange={setColumnIds}
                onSelectAllFiltered={selectAllFiltered}
                onClearSelection={clearSelection}
                onCopyTsv={() => void copyExport("tsv")}
                onCopyMdTable={() => void copyExport("md")}
                onDownloadCsv={() => downloadExport("csv")}
                onDownloadMd={() => downloadExport("md")}
                feedback={copyFeedback}
              />
            }
          />

          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th style={{ width: 36 }}>
                    <input
                      type="checkbox"
                      aria-label="このページを全選択"
                      checked={allPageSelected}
                      onChange={toggleSelectPage}
                    />
                  </th>
                  <th>タイトル</th>
                  <th>確認状態</th>
                  <th>確認優先度</th>
                  <th>確認期日</th>
                </tr>
              </thead>
              <tbody>
                {pagination.total === 0 && (
                  <tr>
                    <td colSpan={5} className={styles.tableEmpty}>
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
                        <input
                          type="checkbox"
                          aria-label={`${s.title}を選択`}
                          checked={selectedIds.has(s.id)}
                          onChange={() => toggleSelect(s.id)}
                        />
                      </td>
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
