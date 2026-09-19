"use client";

import { Suspense, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "@/app/page.module.css";
import { PageTitleRow } from "@/components/HelpLink";
import { PaginationControls, usePagination } from "@/components/Pagination";
import { StatusBadge } from "@/components/RunDetail";
import { useSuggestionPeek } from "@/components/IdFragmentLink";
import { useRuns, useSettingsRules, useSuggestions } from "@/lib/hooks";
import {
  CONFIRM_PRIORITIES,
  CONFIRM_PRIORITY_META,
  SUGGESTION_REVIEW_STATUS_META,
  SUGGESTION_REVIEW_STATUSES,
  compareSuggestionsByConfirmPriority,
  isRunStale,
  isSuggestionReviewOverdue,
  suggestionMatchesKeyword,
  type ConfirmPriority,
  type Suggestion,
  type SuggestionReviewStatus,
} from "@core/types";

// docs/memo.md「デフォルトの確認状態」対応。旧statusFilter="open"相当（未確認・確認中・
// 確認保留）を複数選択の初期値として引き継ぐ（doneだけを除外した状態から始める）。
const DEFAULT_STATUS_FILTER: SuggestionReviewStatus[] = ["unreviewed", "in_review", "deferred"];

/** docs/memo.md「提案一覧のフィルタを複数選択式にしたい」対応。チェックボックス群での
 * トグル。選択が空＝フィルタなし（すべて表示）として扱う（他のcheckbox群フィルタと同じ規約）。 */
function toggleInSet<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

const PAGE_SIZE = 8;

function formatRelativeDays(ts: number, now: number): string {
  const days = Math.floor((now - ts) / (24 * 60 * 60 * 1000));
  if (days <= 0) return "今日";
  if (days === 1) return "1日前";
  return `${days}日前`;
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

function SuggestionsPageInner() {
  const router = useRouter();
  const peek = useSuggestionPeek();
  const { suggestions, suggestionsLoaded, refreshSuggestions } = useSuggestions();
  const { runs, refreshRuns } = useRuns();
  const { rules } = useSettingsRules();
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const staleRunIds = useMemo(
    () => new Set(runs.filter((r) => isRunStale(r.status, r.updatedAt, rules.agentStaleAfterSeconds)).map((r) => r.id)),
    [runs, rules.agentStaleAfterSeconds],
  );

  const [query, setQuery] = useState("");
  const [showDone, setShowDone] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [statusFilter, setStatusFilter] = useState<Set<SuggestionReviewStatus>>(new Set(DEFAULT_STATUS_FILTER));
  const [priorityFilter, setPriorityFilter] = useState<Set<ConfirmPriority>>(new Set());
  const [focusMovingId, setFocusMovingId] = useState<string | null>(null);

  const filtered = suggestions
    .filter((s) => suggestionMatchesKeyword(s, query))
    .filter((s) => {
      if (!showArchived && s.archivedAt) return false;
      if (!showDone && s.reviewStatus === "done") return false;
      if (statusFilter.size > 0 && !statusFilter.has(s.reviewStatus)) return false;
      return true;
    })
    .filter((s) => priorityFilter.size === 0 || priorityFilter.has(s.confirmPriority))
    .slice()
    .sort(compareSuggestionsByConfirmPriority);

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
        <PageTitleRow title="提案" helpAnchor="issues" />
        <div className={styles.panel}>
          {/* ユーザー要望「提案の一覧でキーワード検索できるようにしてください」対応。
              タイトル・メモ・詳細を対象にクライアント側で部分一致検索する。 */}
          <div className={styles.field} style={{ margin: "8px 0" }}>
            <label>キーワード検索（タイトル・メモ・詳細）
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="例: リファクタリング"
            /></label>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 14, margin: "8px 0" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.875rem", color: "var(--text-muted)" }}>
              <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
              確認済み（もう追わない）も表示する（{doneCount}件）
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.875rem", color: "var(--text-muted)" }}>
              <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
              🗄 アーカイブ済みも表示する（{archivedCount}件）
            </label>
          </div>
          {/* docs/memo.md「提案一覧のフィルタを複数選択式にしたい」対応。単一選択のSelectを
              チェックボックス群に置き換え、複数の確認状態・確認優先度を同時に選べるようにする
              （未選択＝フィルタなし、すべて表示）。 */}
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 14, margin: "0 0 8px" }}>
            <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, fontSize: "0.875rem", color: "var(--text-muted)" }}>
              確認状態:
              {SUGGESTION_REVIEW_STATUSES.map((status) => (
                <label key={status} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <input
                    type="checkbox"
                    checked={statusFilter.has(status)}
                    onChange={() => setStatusFilter((prev) => toggleInSet(prev, status))}
                  />
                  {SUGGESTION_REVIEW_STATUS_META[status].icon} {SUGGESTION_REVIEW_STATUS_META[status].label}
                </label>
              ))}
            </span>
            <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, fontSize: "0.875rem", color: "var(--text-muted)" }}>
              確認優先度:
              {CONFIRM_PRIORITIES.map((p) => (
                <label key={p} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <input
                    type="checkbox"
                    checked={priorityFilter.has(p)}
                    onChange={() => setPriorityFilter((prev) => toggleInSet(prev, p))}
                  />
                  {CONFIRM_PRIORITY_META[p].icon} {CONFIRM_PRIORITY_META[p].label}
                </label>
              ))}
            </span>
          </div>

          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>タイトル</th>
                  <th>確認状態</th>
                  <th>確認優先度</th>
                  <th>根拠</th>
                  <th>確認期日</th>
                  <th>最終更新</th>
                </tr>
              </thead>
              <tbody>
                {pagination.total === 0 && (
                  <tr>
                    <td colSpan={6} className={styles.tableEmpty}>
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
                      <td className={styles.tableMuted}>
                        {s.sourceJournalId ? "Journal" : s.sourceRunId ? "相談" : linkedRun ? "Agent" : "—"}
                      </td>
                      <td className={isSuggestionReviewOverdue(s, now) ? styles.errorText : styles.tableMuted}>
                        {s.reviewDueAt
                          ? `${isSuggestionReviewOverdue(s, now) ? "⚠ " : ""}${new Date(s.reviewDueAt).toLocaleDateString("ja-JP")}まで`
                          : "—"}
                      </td>
                      <td className={styles.tableMuted}>{formatRelativeDays(s.updatedAt, now)}</td>
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
          onNavigateChat={(runId) => router.push(`/chat?run=${runId}`)}
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

export default function SuggestionsPage() {
  return (
    <Suspense fallback={null}>
      <SuggestionsPageInner />
    </Suspense>
  );
}
