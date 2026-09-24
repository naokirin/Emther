import { suggestionTitleFromConclusion, YIELD_KIND_META, type SuggestionReviewStatus, type YieldKind } from "../types";
import { listSuggestionCandidatesFromProposal } from "./extraction";
import { originLabel, type AgentRun } from "./types";

// サーバー側は既にkindを正規化して
// 返すが、キャッシュされた古いrunデータ等との保険として同じフォールバックを持つ。
function resolveYieldKind(kind: YieldKind | undefined, optionsLength: number): YieldKind {
  if (kind) return kind;
  return optionsLength === 0 ? "inform" : "decide";
}

// run.taskが空文字のrun（何らかの理由でtask保存に失敗した壊れたデータ）を
// そのままIssueタイトルにすると、サーバー側の「titleは必須です」検証で400になり、EMが
// クリックしても何も起きない（エラーがUIに出ない）まま詰む。run.task以外にも意味のある
// テキスト（Yieldの理由・最初のログ行）があればそれを使い、それも無ければ最低限
// エージェント名だけのタイトルにフォールバックし、Issue化自体は必ず成功させる。
// auto-anomaly/auto-summaryのrunはrun.task自体が「〜を判断
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

// Inbox一覧・「次にすべきこと」で語彙を揃えるための共通ラベル関数。
// yield中はDecide/Inform/Commitの種別まで見せる
// （Morning ModeのYieldカードはDecide/Inform/Commitのみを載せる語彙に揃える）。
// ダッシュボード（判断カード表）と/agents（Inbox一覧）の両方から使う共通ヘルパー。
export function runKindLabel(run: AgentRun): string {
  if (run.status === "yield" && run.yieldRequest) {
    const kind = resolveYieldKind(run.yieldRequest.kind, run.yieldRequest.options.length);
    return YIELD_KIND_META[kind].label;
  }
  if (run.origin !== "manual") return originLabel(run.origin);
  if (run.status === "yield") return "Yield";
  return "手動";
}

/**
 * ダッシュボードの「次の1手」から外す run。
 * 専門Agentへの相談子run、EMが却下したもの、相談自体がアーカイブ済みのもの、
 * 紐づく提案がアーカイブ済み／確認済み(done)のもの。
 * （確認済みとアーカイブは独立フィールドだが、どちらも「もう追わない」ため朝キューから外す。）
 * 様子見は呼び出し側で別扱い（期限内は非表示、期限切れは再浮上）。
 */
export function shouldOmitRunFromNextActions(
  run: Pick<AgentRun, "id" | "consultedBy" | "triageStatus" | "archivedAt">,
  suggestions: { agentRunId?: string; archivedAt?: number; reviewStatus?: SuggestionReviewStatus }[],
): boolean {
  if (run.consultedBy) return true;
  if (run.triageStatus === "dismissed") return true;
  if (run.archivedAt) return true;
  return suggestions.some(
    (s) => s.agentRunId === run.id && (!!s.archivedAt || s.reviewStatus === "done"),
  );
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
