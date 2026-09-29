import { linkJournalToSuggestion } from "../journal-store";
import type { MaskOptions } from "../name-candidate-confirmation";
import {
  adviceFieldsFromProposal,
  createSuggestion,
  getSuggestionByRunId,
  listSuggestions,
  type SuggestionDetailInput,
} from "../suggestion-store";
import { truncateForTitle, type Suggestion } from "../types";
import { listSuggestionCandidatesFromProposal } from "./extraction";
import { appendLog, markRunReviewed, runs } from "./store";
import type { AgentRun, Proposal } from "./types";

// 起票時点の結論・根拠・ロジック・アドバイスを提案自体に固定する。判断・提案（Agent）パネルは
// 紐づくAgent Runが差し替わると内容も変わりうるため、提案作成時にコピーしておく。
export function suggestionDetailFromProposal(proposal: Proposal): SuggestionDetailInput {
  return {
    conclusion: proposal.conclusion,
    facts: proposal.facts,
    logic: proposal.logic,
    ...(proposal.expansions?.length ? { expansions: proposal.expansions } : {}),
    ...(proposal.challenges?.length ? { challenges: proposal.challenges } : {}),
    ...(proposal.explorations?.length ? { explorations: proposal.explorations } : {}),
    ...adviceFieldsFromProposal(proposal),
  };
}

/**
 * 相談 Run（sourceRunId）から提案を1件作る。相談 Run は提案の主分析（agentRunId）に吸収せず、
 * 履歴・続きの壁打ちを残す。reviewed 化と Journal 紐付け（linkJournal=true のとき）もここで行う。
 */
export async function createSuggestionFromConsultRun(
  run: AgentRun,
  title: string,
  opts: MaskOptions & { sourceJournalId?: string; linkJournal?: boolean; autoCreated?: boolean } = {},
): Promise<Suggestion> {
  const { sourceJournalId = run.sourceJournalId, linkJournal = true, autoCreated, ...maskOpts } = opts;
  const suggestion = await createSuggestion(title, {
    ...maskOpts,
    sourceRunId: run.id,
    sourceJournalId: linkJournal ? sourceJournalId : undefined,
    detail: run.proposal ? suggestionDetailFromProposal(run.proposal) : undefined,
    autoCreated,
  });
  markRunReviewed(run.id);
  if (linkJournal && sourceJournalId) {
    await linkJournalToSuggestion(sourceJournalId, suggestion.id, maskOpts).catch(() => {
      // Journal 紐付け失敗で提案作成自体は失敗させない。
    });
  }
  return suggestion;
}

// 分析→相談→「提案として残すか」の確認→提案側で再確認、という二重確認を避けるため、
// AIが新規提案化を勧めた（recommendation: "suggestion"）相談は自動で提案まで作り、
// 要否の判断（確認済み・アーカイブ）は提案側で行う。
// 既存提案への追記（suggestedSuggestionNotes）や整理差分は、想定外に既存提案へ混ざって
// 埋もれるのを防ぐため、従来どおりEMの採用を待つ（ここでは扱わない）。
export function shouldAutoPromoteRunProposal(run: AgentRun, existing: Suggestion[]): boolean {
  if (run.status !== "idle" || !run.proposal) return false;
  if (run.proposal.recommendation !== "suggestion") return false;
  if (run.consultedBy || run.archivedAt || run.triageStatus) return false;
  // テーマ壁打ちは「テーマとして定着」が主アクション。
  if (run.consultIntent === "theme") return false;
  // 提案の更新分析・朝サマリー・蒸留・学び・期間レビューは成果物が別経路。
  if (run.origin !== "manual" && run.origin !== "auto-anomaly" && run.origin !== "auto-journal-batch") return false;
  // 既存提案の分析 Run（提案作成時に自動起動したもの等）は新規提案を生まない。
  if (getSuggestionByRunId(run.id)) return false;
  // 同じ相談から一度でも提案化していれば、続きの壁打ちで重ねて自動起票しない（追加分は手動）。
  if (existing.some((s) => s.sourceRunId === run.id || s.agentRunId === run.id)) return false;
  return listSuggestionCandidatesFromProposal(run.proposal).length > 0;
}

/** 条件を満たす相談 Run の提案候補をすべて提案化する。作成件数を返す（失敗時は0でログのみ）。 */
export async function autoPromoteRunProposal(runId: string): Promise<number> {
  const run = runs.get(runId);
  if (!run || !shouldAutoPromoteRunProposal(run, listSuggestions())) return 0;
  const candidates = listSuggestionCandidatesFromProposal(run.proposal);
  let created = 0;
  try {
    for (let i = 0; i < candidates.length; i++) {
      // Journal紐付けは先頭の1件のみ（手動の複数起票と揃える）。
      await createSuggestionFromConsultRun(run, truncateForTitle(candidates[i].title), {
        linkJournal: i === 0,
        autoCreated: true,
      });
      created++;
    }
  } catch (err) {
    appendLog(
      run,
      "system",
      `提案の自動作成に失敗しました（${(err as Error).message}）。相談画面から手動で提案として残せます。`,
    );
    return created;
  }
  appendLog(run, "system", `AIが提案化を勧めたため、提案を${created}件自動で作成しました。不要なら提案側で確認済み・アーカイブにしてください。`);
  return created;
}
