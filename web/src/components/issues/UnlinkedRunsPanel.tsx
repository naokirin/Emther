"use client";

import { useState } from "react";
import styles from "@/app/page.module.css";
import { StatusBadge, runFallbackTitle, type AgentRun } from "@/components/RunDetail";
import { PaginationControls, usePagination } from "@/components/Pagination";
import { truncateForTitle, type Issue } from "@/lib/types";

const RUNS_PAGE_SIZE = 5;

type Props = {
  runs: AgentRun[];
  issues: Issue[];
  staleRunIds: Set<string>;
  refreshIssues: () => Promise<void> | void;
  refreshRuns: () => Promise<void> | void;
  onNavigateChat: (runId: string) => void;
  onNavigateIssue: (issueId: string) => void;
};

// 「Issue未起票のAgent Run」パネル。この一覧はエージェント名＋タスク要約だけで情報量が
// 少なく、カラムに分けるほどの構造が無いため表形式には戻さずカードのままにする。
export function UnlinkedRunsPanel({ runs, issues, staleRunIds, refreshIssues, refreshRuns, onNavigateChat, onNavigateIssue }: Props) {
  const [promoteError, setPromoteError] = useState<string | null>(null);
  const unlinkedRuns = runs.filter((r) => !issues.some((i) => i.agentRunId === r.id));
  const runsPagination = usePagination(unlinkedRuns, RUNS_PAGE_SIZE);

  // ユーザー指摘対応。Lead Agentは「何でも相談」の相手であり、Dashboard側（P0-2対応）と
  // 同じく即Issue化はせず/chatへ寄せる。決まった介入である専門エージェントのrunだけ
  // ここから直接Issue化する。
  async function handlePromoteRun(run: AgentRun) {
    if (run.agentName === "Lead Agent") {
      onNavigateChat(run.id);
      return;
    }
    setPromoteError(null);
    try {
      const res = await fetch("/api/issues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: truncateForTitle(runFallbackTitle(run)), agentRunId: run.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Issue化に失敗しました");
      await Promise.all([refreshIssues(), refreshRuns()]);
      onNavigateIssue(data.issue.id);
    } catch (err) {
      setPromoteError((err as Error).message);
    }
  }

  return (
    <div className={styles.panel}>
      <h3 style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: "0 0 6px" }}>Issue未起票のAgent Run</h3>
      <p className={styles.subtitle} style={{ marginBottom: 10 }}>
        Lead Agentは「何でも相談」に移動します。専門エージェントはクリックするとIssue化され、詳細画面へ移動します。
      </p>
      {promoteError && (
        <p className={styles.errorText} role="alert">
          {promoteError}
        </p>
      )}
      <div className={styles.runList} style={{ maxHeight: "none" }}>
        {unlinkedRuns.length === 0 && <p className={styles.subtitle}>すべてのRunがIssueに紐づいています。</p>}
        {runsPagination.pageItems.map((run) => (
          <button key={run.id} className={styles.runItem} onClick={() => handlePromoteRun(run)}>
            <div>
              <strong>{run.agentName}</strong> <StatusBadge status={run.status} stale={staleRunIds.has(run.id)} />
              {run.consultedBy && (
                <span className={styles.subtitle} style={{ marginLeft: 6 }}>
                  🔀 {runs.find((r) => r.id === run.consultedBy)?.agentName ?? "Lead Agent"}からの相談
                </span>
              )}
            </div>
            <div className={styles.runItemTask}>{runFallbackTitle(run)}</div>
          </button>
        ))}
      </div>
      <PaginationControls
        page={runsPagination.page}
        totalPages={runsPagination.totalPages}
        total={runsPagination.total}
        rangeStart={runsPagination.rangeStart}
        rangeEnd={runsPagination.rangeEnd}
        onChange={runsPagination.setPage}
      />
    </div>
  );
}
