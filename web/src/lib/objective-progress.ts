import { listIssues } from "@/lib/issue-store";
import { listObjectives, type Objective } from "@/lib/org-context-store";

// Objective（org-context-store）とIssue（issue-store）という2つのドメインを横断する
// 進捗集計なので、どちらのドメイン層にも依存を持たせない
// （org-context-store⇄issue-storeの循環参照を避けるため）。

export type KeyResultProgress = { keyResultId: string; total: number; done: number };
export type ObjectiveWithProgress = Objective & { progress: KeyResultProgress[] };

// docs/memo.md「H」対応。進捗は手動入力ではなく、KeyResultへ紐付いたIssueのうち
// !archived の status=done 件数から機械的に算出する（docs/issue_tracker_contract.md §4）。
export function listObjectivesWithProgress(): ObjectiveWithProgress[] {
  const issues = listIssues();
  return listObjectives().map((o) => ({
    ...o,
    progress: o.keyResults.map((kr) => {
      const linked = issues.filter((i) => i.keyResultId === kr.id && !i.archived);
      return {
        keyResultId: kr.id,
        total: linked.length,
        done: linked.filter((i) => i.status === "done").length,
      };
    }),
  }));
}
