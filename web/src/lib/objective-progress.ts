import { listIssues } from "@/lib/issue-store";
import { listObjectives, type Objective } from "@/lib/org-context-store";

// Objective（org-context-store）とIssue（issue-store）という2つのドメインを横断する
// 進捗集計なので、どちらのドメイン層にも依存を持たせない
// （org-context-store⇄issue-storeの循環参照を避けるため）。

export type KeyResultProgress = { keyResultId: string; total: number };
export type ObjectiveWithProgress = Objective & { progress: KeyResultProgress[] };

// docs/memo.md「H」対応。KeyResultへ紐付いたIssueのうち!archivedの件数を機械的に算出する
// （docs/issue_tracker_contract.md §4）。
// docs/2nd_pivot_version.md Phase 6対応。以前はstatus=done件数を「done」として達成率の
// ように見せていたが、Phase 2.4でstatus編集UIが廃止されて以来この値を書き込む経路が無く
// なり、Reportsで見つかったdoneCountと同じ「常に0になる」バグだった。達成率という体裁を
// やめ、単純な紐付き件数（total）だけを返す。
export function listObjectivesWithProgress(): ObjectiveWithProgress[] {
  const issues = listIssues();
  return listObjectives().map((o) => ({
    ...o,
    progress: o.keyResults.map((kr) => {
      const linked = issues.filter((i) => i.keyResultId === kr.id && !i.archived);
      return {
        keyResultId: kr.id,
        total: linked.length,
      };
    }),
  }));
}
