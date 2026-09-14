"use client";

import { useRouter } from "next/navigation";
import styles from "@/app/page.module.css";
import { StatusBadge, type AgentRun } from "@/components/RunDetail";
import { IssueStatusBadge } from "@/components/IssueStatus";
import { ProgressBar } from "@/components/ProgressBar";
import { charterFilledCount, issueOverviewText, issueProgress, type Issue } from "@/lib/types";

type Props = {
  issue: Issue;
  childIssues: Issue[];
  runs: AgentRun[];
  staleRunIds: Set<string>;
};

// docs/memo.md「K. ズームイン／ズームアウトの協働計画」対応。分解した子Issueの一覧テーブル。
// docs/2nd_pivot_version.md Phase 2.2対応。新規のサブIssue追加／上位Issue作成の起点ボタンは
// 廃止した（EMに新しい階層を手入れさせないため）。既存の親子関係は引き続き読み取り表示する。
export function IssueSubIssuesPanel({ issue, childIssues, runs, staleRunIds }: Props) {
  const router = useRouter();

  // 子（parentIdあり）は自分の子を持てない。子が無ければ表示する内容が無い。
  if (issue.parentId || childIssues.length === 0) return null;

  return (
    <div className={`${styles.panel} ${styles.charterSection}`}>
      <div className={styles.detailHeader}>
        <h2 style={{ margin: 0 }}>サブIssue（分解した子Issue）</h2>
      </div>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>タイトル</th>
              <th>ステータス</th>
              <th>Why/What/How</th>
              <th>進捗</th>
            </tr>
          </thead>
          <tbody>
            {childIssues.map((child) => {
              const childRun = runs.find((r) => r.id === child.agentRunId);
              const childCharter = charterFilledCount(child.charter);
              return (
                <tr key={child.id} style={child.archived ? { opacity: 0.6 } : undefined}>
                  <td>
                    <button
                      className={`${styles.tableRowLink} ${styles.axisTooltip}`}
                      data-tooltip={issueOverviewText(child.charter)}
                      onClick={() => router.push(`/issues/${child.id}`)}
                    >
                      {child.title}
                    </button>
                    <div style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      {childRun && <StatusBadge status={childRun.status} stale={staleRunIds.has(childRun.id)} />}
                      {child.archived && <span className={styles.tableMuted}>🗄 アーカイブ済み</span>}
                    </div>
                  </td>
                  <td>
                    <IssueStatusBadge status={child.status} />
                  </td>
                  <td>
                    <span className={childCharter === 3 ? styles.charterBadgeReady : styles.charterBadgeWarn}>
                      {childCharter === 3 ? "✅" : "❓"} {childCharter}/3
                    </span>
                  </td>
                  <td>
                    <ProgressBar {...issueProgress(child)} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
