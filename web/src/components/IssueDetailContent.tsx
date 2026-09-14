"use client";

import { useState } from "react";
import Link from "next/link";
import styles from "@/app/page.module.css";
import { CopilotChat, ExecutionState, type AgentRun } from "@/components/RunDetail";
import { OriginTrace } from "@/components/OriginTrace";
import { ProgressBar } from "@/components/ProgressBar";
import { PendingAgentStartNotice } from "@/components/PendingAgentStartNotice";
import { IssueTitleHeader } from "@/components/issue-detail/IssueTitleHeader";
import { IssueStrategyMetaPanel } from "@/components/issue-detail/IssueStrategyMetaPanel";
import { IssueLogSection } from "@/components/issue-detail/IssueLogSection";
import { IssueImpactPanel } from "@/components/issue-detail/IssueImpactPanel";
import { IssueSubIssuesPanel } from "@/components/issue-detail/IssueSubIssuesPanel";
import { IssueCharterSection } from "@/components/issue-detail/IssueCharterSection";
import { IssueActionItemsPanel } from "@/components/issue-detail/IssueActionItemsPanel";
import { useIssueDecision } from "@/components/issue-detail/useIssueDecision";
import { useIssueSuggestions } from "@/components/issue-detail/useIssueSuggestions";
import { useEntityHistory, useIssue, useIssueImpact, useIssues, useObjectives, useRuns, useSettingsRules, useTeams, useThemes } from "@/lib/hooks";
import { useNameCandidateConfirm } from "@/lib/useNameCandidateConfirm";
import { issueProgress, isRunStale } from "@/lib/types";
import { journalExcerptFromTask, resolveSourceConsultRun } from "@/lib/origin-trace";

// docs/em_ui_ux_issue.md「一覧⇄詳細をサイドピークで」対応。中身をidベースの
// コンポーネントに切り出し、フルページ（issues/[id]/page）と一覧側のSlideOverの
// 両方から同じロジック・JSXを使う。page.tsx から named export すると Next.js の
// 生成型チェックに弾かれるため、コンポーネントファイルへ分離している。
// docs/memo.md TODO「巨大化したファイルの整理」対応。各機能セクションは
// components/issue-detail/ 以下のパネル・フックへ分割してあり、ここは
// データ取得の単一ソースとしてそれらを並べる組み立て役に留める。
export function IssueDetailContent({ id }: { id: string }) {
  const { issue, sourceJournals, issueLoaded, refreshIssue } = useIssue(id);
  const { history } = useEntityHistory("issue", id);
  const { issues, refreshIssues } = useIssues();
  const { runs, pendingAgentStarts, refreshRuns } = useRuns();
  const { fetchWithNameConfirm, nameCandidateDialog } = useNameCandidateConfirm();
  const { objectives } = useObjectives();
  const { teams } = useTeams();
  const { themes } = useThemes();
  // docs/memo.md「L」＋ docs/issue_tracker_contract.md §6。チーム紐付きIssueで介入前後比較を出す
  // （完了窓は status=done／doneAt。進行中も暫定比較を返す）。
  const { impact, impactLoaded } = useIssueImpact(id, !!issue?.teamId);
  const { rules } = useSettingsRules();
  // eslint-disable-next-line react-hooks/purity -- 「停滞中」表示にのみ使う
  const now = Date.now();
  const staleRunIds = new Set(
    runs.filter((r) => isRunStale(r.status, r.updatedAt, rules.agentStaleAfterSeconds)).map((r) => r.id),
  );

  // 親子関係は1階層のみ。docs/2nd_pivot_version.md Phase 2.2対応で新規作成の起点は
  // 廃止したが、既存の親子関係は引き続き読み取り表示する。
  const parentIssue = issue?.parentId ? issues.find((i) => i.id === issue.parentId) ?? null : null;
  const childIssues = issue ? issues.filter((i) => i.parentId === issue.id) : [];

  const [archiving, setArchiving] = useState(false);

  const linkedRun: AgentRun | null = issue ? runs.find((r) => r.id === issue.agentRunId) ?? null : null;
  const sourceConsult = issue ? resolveSourceConsultRun(issue, runs) : undefined;
  const pendingStart = pendingAgentStarts.find((p) => p.issueId === id) ?? null;

  const { selectedOptionId, setSelectedOptionId, message, setMessage, deciding, decideError, sendDecision, handleConfirmOption, handleFocusChat } =
    useIssueDecision({ linkedRun, fetchWithNameConfirm, refreshRuns });

  const suggestions = useIssueSuggestions({ issue, linkedRun, fetchWithNameConfirm, refreshIssue, refreshIssues, refreshRuns });

  async function handleToggleArchived() {
    if (!issue) return;
    setArchiving(true);
    try {
      const res = await fetch(`/api/issues/${issue.id}/archive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: !issue.archived }),
      });
      if (res.ok) await refreshIssue();
    } finally {
      setArchiving(false);
    }
  }

  if (!issue) {
    return (
      <p className={styles.subtitle}>
        {!issueLoaded ? "読み込み中…" : "Issueが見つかりません。"}
      </p>
    );
  }

  const originJournals =
    sourceJournals.length > 0
      ? sourceJournals
      : issue.sourceJournalId
        ? [{ id: issue.sourceJournalId, rawText: journalExcerptFromTask(sourceConsult?.task ?? linkedRun?.task ?? "") ?? "" }]
        : [];

  return (
    <>
      {parentIssue && (
        <Link href={`/issues/${parentIssue.id}`} className={styles.backLink} style={{ display: "block" }}>
          ⬆ 上位Issue: {parentIssue.title}
        </Link>
      )}
      <OriginTrace journals={originJournals} consult={sourceConsult ?? null} />

      <IssueTitleHeader
        issue={issue}
        linkedRun={linkedRun}
        stale={linkedRun ? staleRunIds.has(linkedRun.id) : false}
        now={now}
        staleInterventionDays={rules.staleInterventionDays}
        archiving={archiving}
        onToggleArchived={handleToggleArchived}
        fetchWithNameConfirm={fetchWithNameConfirm}
        refreshIssue={refreshIssue}
        refreshIssues={refreshIssues}
      />

      <IssueStrategyMetaPanel
        issue={issue}
        teams={teams}
        themes={themes}
        objectives={objectives}
        refreshIssue={refreshIssue}
        refreshIssues={refreshIssues}
      />

      <div className={styles.field}>
        <span className={styles.fieldCaption} title="Action Items + サブIssue（アーカイブした子は除外）">
          進捗
        </span>
        <div style={{ maxWidth: 260 }}>
          <ProgressBar {...issueProgress(issue, childIssues)} />
        </div>
      </div>

      {decideError && <p className={styles.errorText} role="alert">{decideError}</p>}

      {pendingStart && <PendingAgentStartNotice pending={pendingStart} />}

      {/* ユーザー依頼「EMがIssueに対して考えたこと・取ったアクション・結果を反映する」
          対応。Action Items（やる/やった）とは別に、進行中いつでも書き足せる自由記述の
          経過ログ。種別（考えたこと／アクション／結果）は分けず、EMが自由に書く。 */}
      <IssueLogSection issue={issue} refreshIssue={refreshIssue} refreshRuns={refreshRuns} fetchWithNameConfirm={fetchWithNameConfirm} />

      <IssueImpactPanel issue={issue} impact={impact} impactLoaded={impactLoaded} teams={teams} />

      <IssueSubIssuesPanel issue={issue} childIssues={childIssues} runs={runs} staleRunIds={staleRunIds} />

      <IssueCharterSection
        issue={issue}
        history={history}
        refreshIssue={refreshIssue}
        refreshRuns={refreshRuns}
        fetchWithNameConfirm={fetchWithNameConfirm}
      />

      {issue.actionItems.length > 0 && (
        <div className={styles.panel}>
          <IssueActionItemsPanel issue={issue} />
        </div>
      )}

      <div className={styles.issueColumns}>
        <div className={styles.panel}>
          <h2>Execution State</h2>
          {linkedRun ? (
            <ExecutionState
              run={linkedRun}
              selectedOptionId={selectedOptionId}
              onSelectOption={setSelectedOptionId}
              onConfirmOption={handleConfirmOption}
              onFocusChat={handleFocusChat}
              deciding={deciding}
              stale={staleRunIds.has(linkedRun.id)}
              onRetry={() => sendDecision("直前の処理がエラーで中断しました。同じ内容を踏まえて再度実行してください。")}
              onAdoptSubIssues={suggestions.handleAdoptSuggestedSubIssues}
              onDismissSubIssues={suggestions.handleDismissSuggestedSubIssues}
              subIssuesSubmitting={suggestions.subIssuesSubmitting}
              onAdoptCharter={suggestions.handleAdoptSuggestedCharter}
              onDismissCharter={suggestions.handleDismissSuggestedCharter}
              charterSubmitting={suggestions.charterSubmitting}
              onAdoptIssueNotes={suggestions.handleAdoptSuggestedIssueNotes}
              onDismissIssueNotes={suggestions.handleDismissSuggestedIssueNotes}
              issueNotesSubmitting={suggestions.issueNotesSubmitting}
            />
          ) : (
            <p className={styles.subtitle}>
              Agent Run未紐付け。<Link href="/chat">何でも相談</Link>から続けることもできます。
            </p>
          )}
        </div>

        <div className={styles.panel}>
          <h2>Copilot Workspace (Interactive)</h2>
          {linkedRun ? (
            <>
              <p className={styles.subtitle} style={{ marginBottom: 8 }}>壁打ち</p>
              <CopilotChat run={linkedRun} message={message} setMessage={setMessage} deciding={deciding} onDecide={sendDecision} inputId="issue-chat-input" />
            </>
          ) : (
            <p className={styles.subtitle}>Agent Runが無いため会話はありません。</p>
          )}
        </div>
      </div>

      {nameCandidateDialog}
    </>
  );
}
