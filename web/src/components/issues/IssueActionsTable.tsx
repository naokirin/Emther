"use client";

import { useState } from "react";
import styles from "@/app/page.module.css";
import { PaginationControls, usePagination } from "@/components/Pagination";
import { IssueStatusBadge, IssuePriorityBadge } from "@/components/IssueStatus";
import { issueNextAction, type Issue, type IssuePriority } from "@/lib/types";

const ACTIONS_PAGE_SIZE = 8;

type Props = {
  issuesLoaded: boolean;
  filteredIssues: Issue[];
  refreshIssues: () => Promise<void> | void;
  onPeekOpen: (id: string) => void;
};

// ビュー切替「アクション」: Issue横断で「次の一手」だけを優先度順に捌く（週〜月の見通し）。
export function IssueActionsTable({ issuesLoaded, filteredIssues, refreshIssues, onPeekOpen }: Props) {
  const [completingActionKey, setCompletingActionKey] = useState<string | null>(null);

  // Action Itemsビュー: フィルタ済み介入のうち「次の一手」があるものだけ（優先度順は filteredIssues と同じ）。
  const actionRows = filteredIssues.flatMap((issue) => {
    const next = issueNextAction(issue);
    if (!next) return [];
    return [
      {
        issueId: issue.id,
        issueTitle: issue.title,
        priority: (issue.priority ?? "normal") as IssuePriority,
        status: issue.status,
        itemId: next.id,
        itemText: next.text,
      },
    ];
  });
  const actionsPagination = usePagination(actionRows, ACTIONS_PAGE_SIZE);

  async function handleCompleteActionItem(issueId: string, itemId: string) {
    const key = `${issueId}:${itemId}`;
    setCompletingActionKey(key);
    try {
      const res = await fetch(`/api/issues/${issueId}/action-items/${itemId}`, { method: "PATCH" });
      if (res.ok) await refreshIssues();
    } finally {
      setCompletingActionKey(null);
    }
  }

  return (
    <>
      <p className={styles.subtitle} style={{ margin: "0 0 10px" }}>
        各介入の「次の一手」だけを優先度順に表示します。完了すると次の未完了が繰り上がります。あとでやる一覧は Issue 詳細で確認できます。
      </p>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th style={{ width: 40 }}>完了</th>
              <th>次の一手</th>
              <th>優先度</th>
              <th>ステータス</th>
              <th>Issue</th>
            </tr>
          </thead>
          <tbody>
            {actionRows.length === 0 && (
              <tr>
                <td colSpan={5} className={styles.tableEmpty}>
                  {!issuesLoaded
                    ? "読み込み中…"
                    : "条件に一致する次の一手はありません（未設定の介入はリストで確認してください）。"}
                </td>
              </tr>
            )}
            {actionsPagination.pageItems.map((row) => {
              const key = `${row.issueId}:${row.itemId}`;
              return (
                <tr key={key}>
                  <td>
                    <input
                      type="checkbox"
                      checked={false}
                      disabled={completingActionKey === key}
                      aria-label={`「${row.itemText}」を完了`}
                      onChange={() => void handleCompleteActionItem(row.issueId, row.itemId)}
                    />
                  </td>
                  <td>
                    <button type="button" className={styles.tableRowLink} onClick={() => onPeekOpen(row.issueId)}>
                      {row.itemText}
                    </button>
                  </td>
                  <td>
                    <IssuePriorityBadge priority={row.priority} />
                  </td>
                  <td>
                    <IssueStatusBadge status={row.status} />
                  </td>
                  <td>
                    <button type="button" className={styles.tableRowLink} onClick={() => onPeekOpen(row.issueId)}>
                      {row.issueTitle}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <PaginationControls
        page={actionsPagination.page}
        totalPages={actionsPagination.totalPages}
        total={actionsPagination.total}
        rangeStart={actionsPagination.rangeStart}
        rangeEnd={actionsPagination.rangeEnd}
        onChange={actionsPagination.setPage}
      />
    </>
  );
}
