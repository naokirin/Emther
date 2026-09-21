import { randomUUID } from "node:crypto";
import { getSuggestionByRunId, linkSuggestionRun } from "../suggestion-store";
import type { MaskOptions } from "../name-candidate-confirmation";
import { ensureNameCandidatesAllowed } from "../people-directory";
import { getRulesAndConstraints } from "../settings-store";
import { SPECIALIST_AGENTS } from "./agent-catalog";
import { runClaudeTurn, runTeamParallelKickoff } from "./cli-runners/index";
import { beginJournalBatchWindow } from "./journal-batch-window";
import { appendLog, runs, sanitizeForCloud } from "./store";
import { originLabel, type AgentRun, type PendingUnmaskedSend } from "./types";

const pendingUnmaskedSends = new Map<string, PendingUnmaskedSend>();

export function listPendingUnmaskedSends(): PendingUnmaskedSend[] {
  return [...pendingUnmaskedSends.values()];
}

export function parkPendingUnmaskedSend(pending: PendingUnmaskedSend): void {
  pendingUnmaskedSends.set(pending.id, pending);
}

export function dismissPendingUnmaskedSend(id: string): boolean {
  return pendingUnmaskedSends.delete(id);
}

export async function confirmPendingUnmaskedSend(
  id: string,
  opts: MaskOptions = { allowUnmaskedCandidates: true },
): Promise<AgentRun | undefined> {
  const pending = pendingUnmaskedSends.get(id);
  if (!pending) return undefined;
  pendingUnmaskedSends.delete(id);
  const allow: MaskOptions = {
    allowUnmaskedCandidates: opts.registerNameCandidates ? false : (opts.allowUnmaskedCandidates ?? true),
    registerNameCandidates: opts.registerNameCandidates,
  };
  if (pending.kind === "decide-run" && pending.runId && pending.message) {
    return decideRun(pending.runId, pending.message, {
      ...allow,
      teamParallelKickoff: pending.teamParallelKickoff,
    });
  }
  if (pending.kind === "start-run" && pending.agentName && pending.task) {
    return startRun(
      pending.agentName,
      pending.task,
      pending.origin ?? "manual",
      pending.linkedSuggestionId,
      {
        ...allow,
        sourceJournalId: pending.sourceJournalId,
        requiredConsultAgents: pending.requiredConsultAgents,
      },
    );
  }
  return undefined;
}

// 個人情報の分離（ユーザー指摘対応）: run.task・ログへ保存する文言は、SQLiteに書き込む
// 前に必ずマスクする（クラウド送信の直前ではなく、保存の直前にマスクするという設計に
// 変更した）。runをrunsマップへ登録するのは、マスクが完了した後にする——マスク完了前に
// 登録すると、その一瞬だけtaskが空文字列で見えるが、実名が見える瞬間は無い（安全側）。
// ユーザー依頼「Journal等から提案を生成する際、AIエージェントチームに内容を埋めさせる」
// 対応。linkedSuggestionIdを渡すと、実際にClaudeを起動する（runClaudeTurn）前に同期的に
// Suggestion.agentRunIdを紐づける。buildSystemPrompt内のgetSuggestionByRunId（issueContext/
// actionItemsRule/subIssuesRule/charterRuleが参照する）が、最初のターンから
// 紐付き済みの状態を見られるようにするための順序保証（先にrunClaudeTurnを起動して
// 後から紐づけると、非同期処理のタイミング次第で最初のターンに提案の前提が
// 渡らないレースが起き得る）。
export async function startRun(
  agentName: string,
  rawTask: string,
  origin: AgentRun["origin"] = "manual",
  linkedSuggestionId?: string,
  opts: MaskOptions & { sourceJournalId?: string; requiredConsultAgents?: string[] } = {},
): Promise<AgentRun> {
  const { sourceJournalId, requiredConsultAgents, ...maskOpts } = opts;
  await ensureNameCandidatesAllowed([rawTask], maskOpts);
  // Journal集約解釈: 人名確認を通過したあと、CLI非同期起動より前に材料窓を固定する。
  if (origin === "auto-journal-batch") beginJournalBatchWindow();

  const normalizedRequired = requiredConsultAgents
    ?.filter((a) => SPECIALIST_AGENTS.includes(a))
    .filter((a, i, arr) => arr.indexOf(a) === i);

  const run: AgentRun = {
    id: randomUUID(),
    agentName,
    task: "",
    status: "active",
    log: [],
    totalCostUsd: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    origin,
    reviewed: origin === "manual",
    sourceJournalId,
    ...(normalizedRequired && normalizedRequired.length > 0 ? { requiredConsultAgents: normalizedRequired } : {}),
  };
  const maskedTask = await sanitizeForCloud(run, rawTask);
  run.task = maskedTask;
  runs.set(run.id, run);
  if (linkedSuggestionId) linkSuggestionRun(linkedSuggestionId, run.id);
  appendLog(
    run,
    "meta",
    origin === "manual" ? `タスクを受理: ${maskedTask}` : `AIによる自動起動（${originLabel(origin)}）: ${maskedTask}`,
  );
  const shouldTeamKickoff =
    agentName === "Lead Agent" &&
    !!linkedSuggestionId &&
    getRulesAndConstraints().teamParallelKickoffEnabled;
  if (shouldTeamKickoff && linkedSuggestionId) {
    void runTeamParallelKickoff(run, rawTask, maskedTask, linkedSuggestionId);
  } else {
    void runClaudeTurn(run, rawTask, true, maskedTask);
  }
  return run;
}

// ユーザー依頼「Journal等から提案を生成する際、AIエージェントチームに内容を埋めさせる」
// 対応。/api/suggestions・/api/suggestions/[id]/parentの両方（＝「素の提案作成」の全経路）から
// 同じ文面でLead Agentへタスクを渡すための共通ビルダー。issueContext（buildIssueContextBlock）
// が既に紐付き済みのWhy/What/Howをブロックとして注入するが、それが省略されるケース
// （タイトルのみでWhy/What/How・タグが全て空の提案）でもタイトルだけは確実に伝わるよう、
// ここでも明示的に含める。
export function buildSuggestionDraftTask(title: string, charter: { why?: string; what?: string; how?: string }): string {
  const lines = ["新しい提案が起票されました。EMが次の一手を判断できるよう、チームとして分析してください。", `タイトル: ${title}`];
  if (charter.why) lines.push(`Why（記録時点）: ${charter.why}`);
  if (charter.what) lines.push(`What（記録時点）: ${charter.what}`);
  if (charter.how) lines.push(`How（記録時点）: ${charter.how}`);
  lines.push(
    "Why/What/Howのうち未整理な項目があれば埋める提案をし、そのうえで改善の方向性を判断してください。課題が抽象的な場合は子提案への分解案も、必要に応じて提案してください。",
  );
  return lines.join("\n");
}

export async function decideRun(
  id: string,
  rawMessage: string,
  opts: MaskOptions & { teamParallelKickoff?: boolean } = {},
): Promise<AgentRun | undefined> {
  const run = runs.get(id);
  if (!run) return undefined;
  if (run.status === "active" || run.status === "queued") {
    throw new Error("エージェントが実行中または順番待ちのため、今は入力を受け付けられません");
  }
  const { teamParallelKickoff, ...maskOpts } = opts;
  await ensureNameCandidatesAllowed([rawMessage], maskOpts);
  const maskedMessage = await sanitizeForCloud(run, rawMessage);
  appendLog(run, "meta", `EMからの入力: ${maskedMessage}`);

  if (teamParallelKickoff && run.agentName === "Lead Agent") {
    const linkedSuggestion = getSuggestionByRunId(id);
    if (linkedSuggestion) {
      void runTeamParallelKickoff(run, rawMessage, maskedMessage, linkedSuggestion.id);
      return run;
    }
  }

  void runClaudeTurn(run, rawMessage, true, maskedMessage);
  return run;
}
