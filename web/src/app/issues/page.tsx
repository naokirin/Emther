"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import styles from "@/app/page.module.css";
import { SlideOver } from "@/components/SlideOver";
import { IssueFilterBar } from "@/components/issues/IssueFilterBar";
import { IssueListTable } from "@/components/issues/IssueListTable";
import { UnlinkedRunsPanel } from "@/components/issues/UnlinkedRunsPanel";
import { IssueDetailContent } from "@/components/IssueDetailContent";
import { IdResolveProvider } from "@/components/IdFragmentLink";
import { usePagination } from "@/components/Pagination";
import { useIssues, useObjectives, usePeekParam, useRuns, useSettingsRules, useTeams, useThemes } from "@/lib/hooks";
import {
  charterFilledCount,
  compareIssuesByPriority,
  isRunStale,
  type Issue,
  type IssuePriority,
  type IssueStatus,
} from "@/lib/types";

const ISSUES_PAGE_SIZE = 8;

// Issue一覧画面。docs/2nd_pivot_version.md Phase 2.2対応。手動起票（「＋新しいIssue」）は
// 廃止し、Issue化はAI提案の承認（/chatのConsultReviewPanel）経路のみに一本化した。
// Issueを選ぶと/issues/[id]の詳細画面に遷移する。
export default function IssuesPage() {
  return (
    <Suspense fallback={null}>
      <IssuesPageInner />
    </Suspense>
  );
}

function IssuesPageInner() {
  const router = useRouter();
  // docs/memo.md「C. Journalセンシング→行動」対応。Quick Journalの#タグクリックから
  // `/issues?tag=...`で直接この一覧のタグフィルタを開けるようにする。
  const searchParams = useSearchParams();
  // docs/em_ui_ux_issue.md「一覧⇄詳細をサイドピークで」対応。
  const peek = usePeekParam("issue");
  const { issues, issuesLoaded, refreshIssues } = useIssues();
  const { runs, refreshRuns } = useRuns();
  const { objectives } = useObjectives();
  const { teams } = useTeams();
  const { themes } = useThemes();
  const { rules } = useSettingsRules();
  // eslint-disable-next-line react-hooks/purity -- 「最終判断日」の相対表示にのみ使う
  const now = Date.now();
  const staleRunIds = new Set(
    runs.filter((r) => isRunStale(r.status, r.updatedAt, rules.agentStaleAfterSeconds)).map((r) => r.id),
  );

  const [showArchived, setShowArchived] = useState(false);
  const [tagFilter, setTagFilter] = useState(searchParams.get("tag") ?? "");
  const [incompleteOnly, setIncompleteOnly] = useState(false);
  // 既定は「完了・アーカイブ以外」（未着手含む）。アーカイブは showArchived、完了は statusFilter で除外。
  // 並びは compareIssuesByPriority（フォーカス → 通常 → 保留、フォーカス内は focusOrder）。
  const [statusFilter, setStatusFilter] = useState<"open" | "active" | "all" | IssueStatus>("open");
  const [priorityFilter, setPriorityFilter] = useState<"all" | IssuePriority>("all");

  // アーカイブ済みは既定で隠す（docs/memo.md TODO対応）。EMが明示的にトグルした場合のみ表示する。
  const archivedCount = issues.filter((i) => !i.parentId && i.archived).length;

  function matchesIssueFilters(i: Issue): boolean {
    if (!showArchived && i.archived) return false;
    if (tagFilter && !i.tags.includes(tagFilter)) return false;
    if (incompleteOnly && charterFilledCount(i.charter) === 3) return false;
    if (statusFilter === "open") {
      if (i.status === "done") return false;
    } else if (statusFilter === "active") {
      if (i.status !== "in_progress" && i.status !== "blocked") return false;
    } else if (statusFilter !== "all" && i.status !== statusFilter) {
      return false;
    }
    if (priorityFilter !== "all" && (i.priority ?? "normal") !== priorityFilter) return false;
    return true;
  }

  // docs/memo.md TODO「リストにおける、フィルタ機能の拡充、ページネーションの追加を行う」への対応。
  // タグ候補は子Issueも含め（子をフィルタ対象にするため）、アーカイブ表示設定に従う。
  const issuesForTagOptions = issues.filter((i) => showArchived || !i.archived);
  const allTags = Array.from(new Set(issuesForTagOptions.flatMap((i) => i.tags))).sort((a, b) => a.localeCompare(b, "ja"));
  const filteredIssues = issues
    .filter((i) => !i.parentId)
    .filter(matchesIssueFilters)
    .slice()
    .sort(compareIssuesByPriority);
  const issuesPagination = usePagination(filteredIssues, ISSUES_PAGE_SIZE);

  return (
    <IdResolveProvider openIssueInPeek={peek.open}>
    <div className={styles.screen}>
      {/* 改修依頼「セクションの区切りがわかりにくい」対応。ページ全体がフラットな
          .screenの直下に並んでいたため、表形式化でセクション同士が地続きに見えて
          いた。2つのセクションをそれぞれ.panelで囲み、カードとして区切る。 */}
      <div className={styles.panel}>
        <IssueFilterBar
          showArchived={showArchived}
          setShowArchived={setShowArchived}
          archivedCount={archivedCount}
          incompleteOnly={incompleteOnly}
          setIncompleteOnly={setIncompleteOnly}
          statusFilter={statusFilter}
          setStatusFilter={setStatusFilter}
          priorityFilter={priorityFilter}
          setPriorityFilter={setPriorityFilter}
          tagFilter={tagFilter}
          setTagFilter={setTagFilter}
          allTags={allTags}
        />

        <IssueListTable
          issuesPagination={issuesPagination}
          issuesLoaded={issuesLoaded}
          issues={issues}
          runs={runs}
          teams={teams}
          themes={themes}
          objectives={objectives}
          staleRunIds={staleRunIds}
          now={now}
          staleInterventionDays={rules.staleInterventionDays}
          showArchived={showArchived}
          matchesIssueFilters={matchesIssueFilters}
          refreshIssues={refreshIssues}
          onPeekOpen={peek.open}
        />
      </div>

      <UnlinkedRunsPanel
        runs={runs}
        issues={issues}
        staleRunIds={staleRunIds}
        refreshIssues={refreshIssues}
        refreshRuns={refreshRuns}
        onNavigateChat={(runId) => router.push(`/chat?runId=${runId}`)}
        onNavigateIssue={(issueId) => router.push(`/issues/${issueId}`)}
      />

      {peek.id &&
        (() => {
          const peekedIssue = issues.find((i) => i.id === peek.id);
          if (!peekedIssue) return null;
          return (
            <SlideOver title={peekedIssue.title} detailHref={`/issues/${peekedIssue.id}`} onClose={peek.close}>
              <IssueDetailContent id={peekedIssue.id} />
            </SlideOver>
          );
        })()}
    </div>
    </IdResolveProvider>
  );
}
