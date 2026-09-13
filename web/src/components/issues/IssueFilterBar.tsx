"use client";

import styles from "@/app/page.module.css";
import { PageTitleRow } from "@/components/HelpLink";
import { Select } from "@/components/Select";
import { ISSUE_PRIORITY_META, ISSUE_STATUS_META, type IssuePriority, type IssueStatus } from "@/lib/types";

export type IssueViewMode = "list" | "board" | "actions" | "gaps";

type Props = {
  viewMode: IssueViewMode;
  setViewMode: (mode: IssueViewMode) => void;
  onOpenCreateDialog: () => void;
  showArchived: boolean;
  setShowArchived: (value: boolean) => void;
  archivedCount: number;
  incompleteOnly: boolean;
  setIncompleteOnly: (value: boolean) => void;
  statusFilter: "open" | "active" | "all" | IssueStatus;
  setStatusFilter: (value: "open" | "active" | "all" | IssueStatus) => void;
  priorityFilter: "all" | IssuePriority;
  setPriorityFilter: (value: "all" | IssuePriority) => void;
  tagFilter: string;
  setTagFilter: (value: string) => void;
  allTags: string[];
  showChildIssuesOnBoard: boolean;
  setShowChildIssuesOnBoard: (value: boolean) => void;
  filteredChildIssuesCount: number;
};

// Issue一覧のビュー切替タブ・「＋新しいIssue」ボタン・フィルタ行。
export function IssueFilterBar({
  viewMode,
  setViewMode,
  onOpenCreateDialog,
  showArchived,
  setShowArchived,
  archivedCount,
  incompleteOnly,
  setIncompleteOnly,
  statusFilter,
  setStatusFilter,
  priorityFilter,
  setPriorityFilter,
  tagFilter,
  setTagFilter,
  allTags,
  showChildIssuesOnBoard,
  setShowChildIssuesOnBoard,
  filteredChildIssuesCount,
}: Props) {
  return (
    <>
      <PageTitleRow title="課題" helpAnchor="issues">
        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          <div className={styles.tabs} style={{ margin: 0 }}>
            <button
              type="button"
              className={`${styles.tabBtn} ${viewMode === "list" ? styles.tabBtnActive : ""}`}
              onClick={() => setViewMode("list")}
            >
              リスト
            </button>
            <button
              type="button"
              className={`${styles.tabBtn} ${viewMode === "board" ? styles.tabBtnActive : ""}`}
              onClick={() => setViewMode("board")}
            >
              ボード
            </button>
            <button
              type="button"
              className={`${styles.tabBtn} ${viewMode === "actions" ? styles.tabBtnActive : ""}`}
              onClick={() => setViewMode("actions")}
              title="各介入の次の一手を横断表示"
            >
              アクション
            </button>
            <button
              type="button"
              className={`${styles.tabBtn} ${viewMode === "gaps" ? styles.tabBtnActive : ""}`}
              onClick={() => setViewMode("gaps")}
              title="優先スコアの差と介入コストで取り方を見る"
            >
              スコア差
            </button>
          </div>
          <button className={styles.primaryBtn} style={{ width: "auto" }} onClick={onOpenCreateDialog}>
            ＋ 新しいIssue
          </button>
        </div>
      </PageTitleRow>

      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 14, margin: "8px 0" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.8125rem", color: "var(--text-muted)" }}>
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          アーカイブ済み（追わない）も表示する（{archivedCount}件）
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.8125rem", color: "var(--text-muted)" }}>
          <input type="checkbox" checked={incompleteOnly} onChange={(e) => setIncompleteOnly(e.target.checked)} />
          Why/What/How未整理のみ
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.8125rem", color: "var(--text-muted)" }}>
          ステータス:
          <Select
            value={statusFilter}
            onChange={(v) => setStatusFilter(v as "open" | "active" | "all" | IssueStatus)}
            options={[
              { value: "open", label: "完了・アーカイブ以外" },
              { value: "active", label: "進行中・Waiting" },
              { value: "all", label: "すべて" },
              ...Object.entries(ISSUE_STATUS_META).map(([value, meta]) => ({
                value,
                label: `${meta.icon} ${meta.label}`,
              })),
            ]}
            style={{ minWidth: 180 }}
          />
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.8125rem", color: "var(--text-muted)" }}>
          優先度:
          <Select
            value={priorityFilter}
            onChange={(v) => setPriorityFilter(v as "all" | IssuePriority)}
            options={[
              { value: "all", label: "すべて" },
              ...Object.entries(ISSUE_PRIORITY_META).map(([value, meta]) => ({
                value,
                label: `${meta.icon} ${meta.label}`,
              })),
            ]}
            style={{ minWidth: 140 }}
          />
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.8125rem", color: "var(--text-muted)" }}>
          タグで絞り込み:
          <Select
            value={tagFilter}
            onChange={setTagFilter}
            options={[{ value: "", label: "すべて" }, ...allTags.map((tag) => ({ value: tag, label: `#${tag}` }))]}
            style={{ minWidth: 160 }}
          />
        </label>
        {viewMode === "board" && (
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.8125rem", color: "var(--text-muted)" }}>
            <input
              type="checkbox"
              checked={showChildIssuesOnBoard}
              onChange={(e) => setShowChildIssuesOnBoard(e.target.checked)}
            />
            子Issueも表示する（{filteredChildIssuesCount}件）
          </label>
        )}
      </div>
    </>
  );
}
