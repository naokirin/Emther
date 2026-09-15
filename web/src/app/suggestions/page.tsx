"use client";

import { Suspense, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "@/app/page.module.css";
import { PageTitleRow } from "@/components/HelpLink";
import { Select } from "@/components/Select";
import { PaginationControls, usePagination } from "@/components/Pagination";
import { StatusBadge } from "@/components/RunDetail";
import { useSuggestionPeek } from "@/components/IdFragmentLink";
import { useRuns, useSettingsRules, useSuggestions } from "@/lib/hooks";
import {
  CONFIRM_PRIORITIES,
  CONFIRM_PRIORITY_META,
  SUGGESTION_REVIEW_STATUS_META,
  compareSuggestionsByConfirmPriority,
  isRunStale,
  isSuggestionOpen,
  type ConfirmPriority,
  type Suggestion,
  type SuggestionReviewStatus,
} from "@/lib/types";

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

  const [showDone, setShowDone] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"open" | SuggestionReviewStatus | "all">("open");
  const [priorityFilter, setPriorityFilter] = useState<"all" | ConfirmPriority>("all");
  const [focusMovingId, setFocusMovingId] = useState<string | null>(null);

  const filtered = suggestions
    .filter((s) => {
      if (!showDone && s.reviewStatus === "done") return false;
      if (statusFilter === "open") return isSuggestionOpen(s);
      if (statusFilter === "all") return true;
      return s.reviewStatus === statusFilter;
    })
    .filter((s) => priorityFilter === "all" || s.confirmPriority === priorityFilter)
    .slice()
    .sort(compareSuggestionsByConfirmPriority);

  const pagination = usePagination(filtered, PAGE_SIZE);
  const doneCount = suggestions.filter((s) => s.reviewStatus === "done").length;

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
        <div className={styles.panel}>
          <PageTitleRow title="提案" helpAnchor="issues" />
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 14, margin: "8px 0" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.875rem", color: "var(--text-muted)" }}>
              <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
              確認済み（もう追わない）も表示する（{doneCount}件）
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.875rem", color: "var(--text-muted)" }}>
              確認状態:
              <Select
                value={statusFilter}
                onChange={(v) => setStatusFilter(v as typeof statusFilter)}
                options={[
                  { value: "open", label: "未確認・確認保留" },
                  { value: "all", label: "すべて" },
                  { value: "unreviewed", label: "未確認のみ" },
                  { value: "deferred", label: "確認保留のみ" },
                  { value: "done", label: "確認済みのみ" },
                ]}
                style={{ minWidth: 160 }}
              />
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.875rem", color: "var(--text-muted)" }}>
              確認優先度:
              <Select
                value={priorityFilter}
                onChange={(v) => setPriorityFilter(v as typeof priorityFilter)}
                options={[
                  { value: "all", label: "すべて" },
                  ...CONFIRM_PRIORITIES.map((p) => ({
                    value: p,
                    label: `${CONFIRM_PRIORITY_META[p].icon} ${CONFIRM_PRIORITY_META[p].label}`,
                  })),
                ]}
                style={{ minWidth: 140 }}
              />
            </label>
          </div>

          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>タイトル</th>
                  <th>確認状態</th>
                  <th>確認優先度</th>
                  <th>根拠</th>
                  <th>最終更新</th>
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
                        <button className={styles.tableRowLink} onClick={() => peek.open(s.id)}>
                          {s.title}
                        </button>
                        <div style={{ marginTop: 4, display: "flex", gap: 6, flexWrap: "wrap" }}>
                          {linkedRun && (
                            <StatusBadge status={linkedRun.status} stale={staleRunIds.has(linkedRun.id)} />
                          )}
                          {s.sourceJournalId && <span className={styles.tableMuted}>📝 Journalから</span>}
                          {s.sourceRunId && <span className={styles.tableMuted}>💬 相談から</span>}
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
