import { NextResponse } from "next/server";
import { createSuggestion, listSuggestions, toSuggestionView } from "@/lib/suggestion-store";
import { buildIssueDraftTask, getRun, markRunReviewed, parkPendingUnmaskedSend, startRun } from "@/lib/agent-runtime";
import { isUnconfirmedNameCandidatesError } from "@/lib/name-candidate-confirmation";
import { jsonFromUnknownError, maskOptionsFromBody } from "@/app/api/name-candidate-response";
import { linkJournalToIssue } from "@/lib/journal-store";
import { CONFIRM_PRIORITIES, type ConfirmPriority } from "@/lib/types";

export async function GET() {
  return NextResponse.json({ suggestions: listSuggestions().map(toSuggestionView) });
}

// docs/2nd_pivot_version.md Phase 7。相談／Journal／未紐付け Run から提案を残す入口。
// - agentRunId あり: その Run を提案の主分析として紐付け、reviewed 化（Inbox 等からの起票）。
// - sourceRunId のみ: 相談スレッドは相談履歴に残し、提案専用の新規分析 Run は起動しない。
// - どちらも無し: Lead Agent の分析 Run を自動起動する（旧 Issue 起票と同じ）。
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const agentRunId = typeof body?.agentRunId === "string" && body.agentRunId ? body.agentRunId : undefined;

  if (!title) {
    return NextResponse.json({ error: "titleは必須です" }, { status: 400 });
  }

  const keyResultId = typeof body?.keyResultId === "string" && body.keyResultId ? body.keyResultId : undefined;
  const themeId = typeof body?.themeId === "string" && body.themeId ? body.themeId : undefined;
  const teamId = typeof body?.teamId === "string" && body.teamId ? body.teamId : undefined;
  const confirmPriority =
    typeof body?.confirmPriority === "string" && CONFIRM_PRIORITIES.includes(body.confirmPriority as ConfirmPriority)
      ? (body.confirmPriority as ConfirmPriority)
      : typeof body?.priority === "string" && CONFIRM_PRIORITIES.includes(body.priority as ConfirmPriority)
        ? (body.priority as ConfirmPriority)
        : undefined;
  const opts = maskOptionsFromBody(body);
  const sourceRunId =
    typeof body?.sourceRunId === "string" && body.sourceRunId.trim()
      ? body.sourceRunId.trim()
      : agentRunId;
  const sourceRun = agentRunId ? getRun(agentRunId) : sourceRunId ? getRun(sourceRunId) : undefined;
  const sourceJournalId =
    typeof body?.sourceJournalId === "string" && body.sourceJournalId.trim()
      ? body.sourceJournalId.trim()
      : sourceRun?.sourceJournalId;

  // docs/memo.md「メモとは別に提案自体の詳細を残す単一の場所」対応。sourceRunの内部表現
  // （マスク済み）にproposalがあれば、起票直後にそのままdetailとして持たせる。判断・提案
  // （Agent）パネルは紐づくAgent Runが差し替わると内容も変わりうるため、起票時点の結論・
  // 根拠・ロジック・アドバイスを提案自体に固定するのがねらい。
  const detail = sourceRun?.proposal
    ? {
        conclusion: sourceRun.proposal.conclusion,
        facts: sourceRun.proposal.facts,
        logic: sourceRun.proposal.logic,
        ...(sourceRun.proposal.expansions?.length
          ? { expansions: sourceRun.proposal.expansions }
          : {}),
        ...(sourceRun.proposal.challenges?.length
          ? { challenges: sourceRun.proposal.challenges }
          : {}),
        ...(sourceRun.proposal.advice ? { advice: sourceRun.proposal.advice } : {}),
      }
    : undefined;

  try {
    const suggestion = await createSuggestion(title, {
      ...opts,
      agentRunId,
      sourceRunId,
      sourceJournalId,
      keyResultId,
      themeId,
      teamId,
      confirmPriority,
      detail,
    });
    if (agentRunId) {
      markRunReviewed(agentRunId);
      if (sourceJournalId) {
        await linkJournalToIssue(sourceJournalId, suggestion.id, opts).catch(() => {
          // Journal 紐付け失敗で提案作成自体は失敗させない。
        });
      }
    } else if (sourceRunId) {
      // 相談からの提案化: 相談 Run を提案の主分析に吸収せず、履歴・続きの壁打ちを残す。
      markRunReviewed(sourceRunId);
      if (sourceJournalId) {
        await linkJournalToIssue(sourceJournalId, suggestion.id, opts).catch(() => {
          // Journal 紐付け失敗で提案作成自体は失敗させない。
        });
      }
    } else {
      const task = buildIssueDraftTask(title, {});
      try {
        await startRun("Lead Agent", task, "manual", suggestion.id, { ...opts, sourceJournalId });
      } catch (err) {
        if (isUnconfirmedNameCandidatesError(err)) {
          parkPendingUnmaskedSend({
            id: `unmasked-start:${suggestion.id}:${Date.now()}`,
            kind: "start-run",
            candidates: err.candidates,
            label: "提案作成直後の分析送信確認",
            issueId: suggestion.id,
            issueTitle: title,
            agentName: "Lead Agent",
            task,
            origin: "manual",
            linkedIssueId: suggestion.id,
            sourceJournalId,
          });
        }
      }
    }
    return NextResponse.json({ suggestion: toSuggestionView(suggestion) }, { status: 201 });
  } catch (err) {
    return jsonFromUnknownError(err, 400);
  }
}
