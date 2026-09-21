import styles from "../styles/page.module.css";
import { suggestionTitleFromConclusion, YIELD_KIND_META } from "@emther/core/types";
import { listSuggestionCandidatesFromProposal, resolveYieldKind } from "./run-detail/run-view-helpers";
import type { AgentRun, AgentStatus } from "./RunDetail";

// ユーザー指摘対応: run.taskが空文字のrun（何らかの理由でtask保存に失敗した壊れたデータ）を
// そのままIssueタイトルにすると、サーバー側の「titleは必須です」検証で400になり、EMが
// クリックしても何も起きない（エラーがUIに出ない）まま詰む。run.task以外にも意味のある
// テキスト（Yieldの理由・最初のログ行）があればそれを使い、それも無ければ最低限
// エージェント名だけのタイトルにフォールバックし、Issue化自体は必ず成功させる。
//
// ユーザー指摘対応（続報）: auto-anomaly/auto-summaryのrunはrun.task自体が「〜を判断
// してください」という定型の指示文＋本文という長い文字列で、EMが書いた短い文ではない。
// これをそのままタイトルにすると（呼び出し側でtruncateForTitleしても）本文へ辿り着く
// 前の定型句だけが残ってしまう。proposal.suggestionTitle（短い課題名）があれば最優先。
// 無ければ conclusion から判断メタを除いた候補を使い、それも無ければ task 等へ落ちる。
export function runFallbackTitle(run: AgentRun): string {
  const suggestionTitle = run.proposal?.suggestionTitle?.trim();
  if (suggestionTitle) return suggestionTitle;
  const firstCandidate = listSuggestionCandidatesFromProposal(run.proposal)[0]?.title;
  if (firstCandidate) return firstCandidate;
  const conclusion = run.proposal?.conclusion.trim();
  if (conclusion) return suggestionTitleFromConclusion(conclusion);
  const task = run.task.trim();
  if (task) return task;
  const yieldReason = run.yieldRequest?.reason.trim();
  if (yieldReason) return yieldReason;
  const firstLogLine = run.log.find((l) => l.channel !== "system")?.text.trim();
  if (firstLogLine) return firstLogLine;
  return `${run.agentName}のRun（内容未記録）`;
}

export const STATUS_META: Record<AgentStatus, { icon: string; label: string; cls: string }> = {
  active: { icon: "🟢", label: "Active", cls: styles.active },
  queued: { icon: "⏳", label: "Queued（順番待ち）", cls: styles.queued },
  yield: { icon: "🟡", label: "Yield / Waiting", cls: styles.yield },
  idle: { icon: "⚪️", label: "Idle（完了・待機中）", cls: styles.idle },
  error: { icon: "🔴", label: "Error", cls: styles.error },
};

// docs/memo.md「A」対応。Inbox一覧・「次にすべきこと」で語彙を揃えるための共通ラベル関数。
// docs/em_ui_ux_issue.md 5節対応。yield中はDecide/Inform/Commitの種別まで見せる
// （§2.3「Morning ModeのYieldカードはDecide/Inform/Commitのみを載せる」の語彙を揃える）。
// ダッシュボード（判断カード表）と/agents（Inbox一覧）の両方から使う共通ヘルパー。
export function runKindLabel(run: AgentRun): string {
  if (run.status === "yield" && run.yieldRequest) {
    const kind = resolveYieldKind(run.yieldRequest.kind, run.yieldRequest.options.length);
    return YIELD_KIND_META[kind].label;
  }
  if (run.origin === "auto-anomaly") return "Journal自動分析";
  if (run.origin === "auto-summary") return "朝のサマリー";
  if (run.origin === "auto-suggestion-update") return "提案更新分析";
  if (run.origin === "auto-distill") return "状況蒸留";
  if (run.origin === "auto-journal-batch") return "Journal集約解釈";
  if (run.origin === "auto-weekly-report") return "週次レビュー";
  if (run.origin === "auto-monthly-report") return "月次レビュー";
  if (run.status === "yield") return "Yield";
  return "手動";
}

/**
 * ダッシュボードの「次の1手」から外す run。
 * 専門Agentへの相談子run、EMが却下したもの、相談自体がアーカイブ済みのもの、
 * 紐づく提案がアーカイブ済みのもの。
 * 様子見は呼び出し側で別扱い（期限内は非表示、期限切れは再浮上）。
 */
export function shouldOmitRunFromNextActions(
  run: Pick<AgentRun, "id" | "consultedBy" | "triageStatus" | "archivedAt">,
  suggestions: { agentRunId?: string; archivedAt?: number }[],
): boolean {
  if (run.consultedBy) return true;
  if (run.triageStatus === "dismissed") return true;
  if (run.archivedAt) return true;
  return suggestions.some((s) => s.agentRunId === run.id && !!s.archivedAt);
}

/** 自動起動かつ未トリアージ（起票／様子見／却下前）のドラフト。Issue行ではなく AgentRun が正。 */
export function isDraftAwaitingTriage(
  run: Pick<AgentRun, "origin" | "reviewed" | "triageStatus">,
): boolean {
  return (
    run.origin !== "manual" &&
    !run.reviewed &&
    run.triageStatus !== "watching" &&
    run.triageStatus !== "dismissed"
  );
}

/**
 * ダッシュボード／相談の「ドラフト提案」語彙。
 * idle完了＝起票待ち、active/queued＝分析中。yield/error は従来の種別ラベルを優先。
 */
export function draftKindLabel(run: AgentRun): string {
  if (!isDraftAwaitingTriage(run)) return runKindLabel(run);
  if (run.status === "active" || run.status === "queued") return "ドラフト分析中";
  if (run.status === "idle") return "ドラフト提案";
  return runKindLabel(run);
}
