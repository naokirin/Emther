import { issueBacklogActionItems, issueNextAction, type Issue } from "@/lib/types";

type Props = {
  issue: Issue;
};

// docs/2nd_pivot_version.md Phase 2.4対応。Action ItemのCRUD（追加・完了チェック・削除・
// 子Issueへの昇格）は、EMにIssueの構造を手入れさせる方針と衝突するため廃止した。
// 既存Issueに残るAction Itemは、対応履歴として読み取り専用で表示するだけに留める。
export function IssueActionItemsPanel({ issue }: Props) {
  if (issue.actionItems.length === 0) return null;

  const nextItem = issueNextAction(issue);
  const backlog = issueBacklogActionItems(issue);
  const doneItems = issue.actionItems.filter((a) => a.done);

  return (
    <>
      <h2 style={{ marginTop: 16, marginBottom: 8 }}>Action Items（記録）</h2>
      {nextItem && (
        <>
          <h3 style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: "0 0 6px" }}>次の一手だったもの</h3>
          <p style={{ fontSize: "0.875rem", marginBottom: 10 }}>{nextItem.text}</p>
        </>
      )}
      {backlog.length > 0 && (
        <>
          <h3 style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: "0 0 6px" }}>あとでやる予定だったもの</h3>
          <ul style={{ listStyle: "none", marginBottom: 10 }}>
            {backlog.map((item) => (
              <li key={item.id} style={{ fontSize: "0.875rem", marginBottom: 4 }}>
                {item.text}
              </li>
            ))}
          </ul>
        </>
      )}
      {doneItems.length > 0 && (
        <>
          <h3 style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: "0 0 6px" }}>完了</h3>
          <ul style={{ listStyle: "none", marginBottom: 10 }}>
            {doneItems.map((item) => (
              <li key={item.id} style={{ fontSize: "0.875rem", marginBottom: 4, textDecoration: "line-through", color: "var(--text-muted)" }}>
                {item.text}
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
