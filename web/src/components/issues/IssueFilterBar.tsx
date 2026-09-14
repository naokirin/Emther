"use client";

import { PageTitleRow } from "@/components/HelpLink";
import { Select } from "@/components/Select";
import { ISSUE_PRIORITY_META, ISSUE_STATUS_META, type IssuePriority, type IssueStatus } from "@/lib/types";

type Props = {
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
};

// Issue一覧のフィルタ行。
// docs/2nd_pivot_version.md Phase 2.2対応。「＋新しいIssue」ボタン（手動作成）と、
// ボード／スコア差ビュー（ステータス・優先度の手入れを促す画面）は廃止した。
// Issue化はAI提案の承認（/chatのConsultReviewPanel）経路のみに一本化する。
// docs/2nd_pivot_version.md Phase 2.4対応。「アクション」ビュー（Action Item横断完了）
// も、Action Item CRUD廃止に伴い削除し、ビュー切替タブ自体を無くした。
export function IssueFilterBar({
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
}: Props) {
  return (
    <>
      <PageTitleRow title="課題" helpAnchor="issues" />

      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 14, margin: "8px 0" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.875rem", color: "var(--text-muted)" }}>
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          アーカイブ済み（追わない）も表示する（{archivedCount}件）
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.875rem", color: "var(--text-muted)" }}>
          <input type="checkbox" checked={incompleteOnly} onChange={(e) => setIncompleteOnly(e.target.checked)} />
          Why/What/How未整理のみ
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.875rem", color: "var(--text-muted)" }}>
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
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.875rem", color: "var(--text-muted)" }}>
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
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.875rem", color: "var(--text-muted)" }}>
          タグで絞り込み:
          <Select
            value={tagFilter}
            onChange={setTagFilter}
            options={[{ value: "", label: "すべて" }, ...allTags.map((tag) => ({ value: tag, label: `#${tag}` }))]}
            style={{ minWidth: 160 }}
          />
        </label>
      </div>
    </>
  );
}
