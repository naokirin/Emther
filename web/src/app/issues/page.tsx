"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import styles from "@/app/page.module.css";
import { IssueBoard } from "@/components/IssueBoard";
import { IssueScoreGapsView } from "@/components/IssueScoreGapsView";
import { SlideOver } from "@/components/SlideOver";
import { IssueCreateDialog } from "@/components/issues/IssueCreateDialog";
import { IssueFilterBar, type IssueViewMode } from "@/components/issues/IssueFilterBar";
import { IssueTriageToolbar } from "@/components/issues/IssueTriageToolbar";
import { IssueListTable } from "@/components/issues/IssueListTable";
import { IssueActionsTable } from "@/components/issues/IssueActionsTable";
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

// Issue一覧画面。起票は一般的なIssue管理サービスと同様、一覧上の「＋ 新しいIssue」ボタンから
// ダイアログを開いて行う（画面遷移しない）。Issueを選ぶと/issues/[id]の詳細画面に遷移する。
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

  // docs/em_ui_ux_issue.md 4節「ビューの切り替え機能」対応。
  // Action Itemsビュー: Issue横断で「次の一手」だけを優先度順に捌く（週〜月の見通し）。
  // スコア差ビュー: 優先スコアの長さと隣との差で取り方を補佐する。
  const [viewMode, setViewMode] = useState<IssueViewMode>("list");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [tagFilter, setTagFilter] = useState(searchParams.get("tag") ?? "");
  const [incompleteOnly, setIncompleteOnly] = useState(false);
  // 既定は「完了・アーカイブ以外」（未着手含む）。アーカイブは showArchived、完了は statusFilter で除外。
  // 並びは compareIssuesByPriority（フォーカス → 通常 → 保留、フォーカス内は focusOrder）。
  const [statusFilter, setStatusFilter] = useState<"open" | "active" | "all" | IssueStatus>("open");
  const [priorityFilter, setPriorityFilter] = useState<"all" | IssuePriority>("all");
  // ボード: 子Issueを自身のステータス列へ独立カードとして出すか。
  const [showChildIssuesOnBoard, setShowChildIssuesOnBoard] = useState(false);

  // アーカイブ済みは既定で隠す（docs/memo.md TODO対応）。EMが明示的にトグルした場合のみ表示する。
  // リストはトップレベルを主行とし、展開時の子／ボードの子トグルも同じフィルタを通す。
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
  const filteredChildIssues = issues
    .filter((i) => !!i.parentId)
    .filter(matchesIssueFilters)
    .slice()
    .sort(compareIssuesByPriority);
  const boardIssues = showChildIssuesOnBoard
    ? [...filteredIssues, ...filteredChildIssues].slice().sort(compareIssuesByPriority)
    : filteredIssues;
  const issuesPagination = usePagination(filteredIssues, ISSUES_PAGE_SIZE);

  return (
    <IdResolveProvider openIssueInPeek={peek.open}>
    <div className={styles.screen}>
      {/* 改修依頼「セクションの区切りがわかりにくい」対応。ページ全体がフラットな
          .screenの直下に並んでいたため、表形式化でセクション同士が地続きに見えて
          いた。2つのセクションをそれぞれ.panelで囲み、カードとして区切る。 */}
      <div className={styles.panel}>
        <IssueFilterBar
          viewMode={viewMode}
          setViewMode={setViewMode}
          onOpenCreateDialog={() => setDialogOpen(true)}
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
          showChildIssuesOnBoard={showChildIssuesOnBoard}
          setShowChildIssuesOnBoard={setShowChildIssuesOnBoard}
          filteredChildIssuesCount={filteredChildIssues.length}
        />

        <IssueTriageToolbar
          issues={issues}
          themes={themes}
          objectives={objectives}
          refreshIssues={refreshIssues}
          onPeekOpen={peek.open}
        />

        {viewMode === "board" ? (
          <IssueBoard
            issues={boardIssues}
            allIssues={issues}
            now={now}
            staleInterventionDays={rules.staleInterventionDays}
            onSelect={(id) => peek.open(id)}
          />
        ) : viewMode === "actions" ? (
          <IssueActionsTable
            issuesLoaded={issuesLoaded}
            filteredIssues={filteredIssues}
            refreshIssues={refreshIssues}
            onPeekOpen={peek.open}
          />
        ) : viewMode === "gaps" ? (
          !issuesLoaded ? (
            <p className={styles.subtitle}>読み込み中…</p>
          ) : (
            <IssueScoreGapsView issues={filteredIssues} onSelect={(id) => peek.open(id)} />
          )
        ) : (
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
        )}
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

      <IssueCreateDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        runs={runs}
        teams={teams}
        themes={themes}
        objectives={objectives}
        onCreated={(issueId) => router.push(`/issues/${issueId}`)}
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
