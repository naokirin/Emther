"use client";

import { PageTitleRow } from "@/components/HelpLink";
import { Select } from "@/components/Select";

type Props = {
  showArchived: boolean;
  setShowArchived: (value: boolean) => void;
  archivedCount: number;
  incompleteOnly: boolean;
  setIncompleteOnly: (value: boolean) => void;
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
// docs/2nd_pivot_version.md Phase 6対応。ステータス/優先度フィルタは、対応する編集UIが
// 既に無く「絞り込んで管理する軸」ではなくなっていたため撤去した。一覧の行内バッジ表示
// （読み取り専用の軽い文脈情報）はそのまま維持する。
export function IssueFilterBar({
  showArchived,
  setShowArchived,
  archivedCount,
  incompleteOnly,
  setIncompleteOnly,
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
