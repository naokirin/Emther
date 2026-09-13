"use client";

import { useRouter } from "next/navigation";
import styles from "@/app/page.module.css";
import { StatusBadge, type AgentRun } from "@/components/RunDetail";
import { IssueStatusBadge } from "@/components/IssueStatus";
import { ProgressBar } from "@/components/ProgressBar";
import { charterFilledCount, issueProgress, type Issue } from "@/lib/types";

type Props = {
  issue: Issue;
  childIssues: Issue[];
  runs: AgentRun[];
  staleRunIds: Set<string>;
  onOpenChildDialog: () => void;
  onOpenParentDialog: () => void;
};

// docs/memo.md「K. ズームイン／ズームアウトの協働計画」対応。分解した子Issueの一覧テーブルと、
// サブIssue追加／上位Issue作成の起点ボタン。親子関係は1階層のみ。
export function IssueSubIssuesPanel({ issue, childIssues, runs, staleRunIds, onOpenChildDialog, onOpenParentDialog }: Props) {
  const router = useRouter();

  // 子（parentIdあり）は自分の子を持てないので「サブIssueを追加」は表示せず、
  // 「上位Issueを作る」も既に親を持つなら表示しない。
  if (issue.parentId) return null;

  return (
    <div className={`${styles.panel} ${styles.charterSection}`}>
      <div className={styles.detailHeader}>
        <h2 style={{ margin: 0 }}>サブIssue（分解した子Issue）</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <button className={styles.btnOutline} onClick={onOpenChildDialog}>
            ＋ サブIssueを追加
          </button>
          {childIssues.length === 0 && (
            <button className={styles.btnOutline} onClick={onOpenParentDialog}>
              ⬆ 上位Issueを作る
            </button>
          )}
        </div>
      </div>
      {childIssues.length === 0 ? (
        <p className={styles.subtitle}>まだサブIssueはありません。</p>
      ) : (
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
                      <button className={styles.tableRowLink} onClick={() => router.push(`/issues/${child.id}`)}>
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
      )}
    </div>
  );
}
