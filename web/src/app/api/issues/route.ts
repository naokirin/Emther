import { NextResponse } from "next/server";
import { createIssue, listIssues, toIssueView } from "@/lib/issue-store";
import { buildIssueDraftTask, getRun, markRunReviewed, parkPendingUnmaskedSend, startRun } from "@/lib/agent-runtime";
import { isUnconfirmedNameCandidatesError } from "@/lib/name-candidate-confirmation";
import { jsonFromUnknownError, maskOptionsFromBody } from "@/app/api/name-candidate-response";
import { linkJournalToIssue } from "@/lib/journal-store";
import { ISSUE_PRIORITIES, type IssuePriority } from "@/lib/types";

export async function GET() {
  return NextResponse.json({ issues: listIssues().map(toIssueView) });
}

// ユーザー依頼「Journal等からIssueを生成する際、AIエージェントチームに内容を埋めさせる」
// 対応。既存のAgent Run（EM主導のチャット・Dashboard等）から起票された場合は
// agentRunIdが渡るのでそちらに委ね、それ以外（Journal起票・Issues一覧の手動起票・
// サブIssue追加など、agentRunIdの無い「素のIssue作成」）だけ、作成直後にLead Agentの
// 分析Runを自動で紐づける。Lead Agentはconsultで専門エージェントに相談できるため、
// 「チームで内容を埋める」を単一エントリポイント（このAPI）だけで全経路に効かせられる。
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const agentRunId = typeof body?.agentRunId === "string" && body.agentRunId ? body.agentRunId : undefined;
  const parentId = typeof body?.parentId === "string" && body.parentId ? body.parentId : undefined;

  if (!title) {
    return NextResponse.json({ error: "titleは必須です" }, { status: 400 });
  }

  const tags = Array.isArray(body?.tags)
    ? body.tags.filter((t: unknown): t is string => typeof t === "string")
    : undefined;
  const keyResultId = typeof body?.keyResultId === "string" && body.keyResultId ? body.keyResultId : undefined;
  const teamId = typeof body?.teamId === "string" && body.teamId ? body.teamId : undefined;
  const priority =
    typeof body?.priority === "string" && ISSUE_PRIORITIES.includes(body.priority as IssuePriority)
      ? (body.priority as IssuePriority)
      : undefined;
  const charter = {
    why: typeof body?.why === "string" ? body.why : undefined,
    what: typeof body?.what === "string" ? body.what : undefined,
    how: typeof body?.how === "string" ? body.how : undefined,
  };
  const opts = maskOptionsFromBody(body);
  // 同一相談から親なし複数Issueを切るとき、2件目以降は agentRunId を付けず
  // sourceRunId だけ渡して生成元を残す（agentRunId は1 Issue に1 Run の紐付け制約）。
  const sourceRunId =
    typeof body?.sourceRunId === "string" && body.sourceRunId.trim()
      ? body.sourceRunId.trim()
      : agentRunId;
  const sourceRun = agentRunId ? getRun(agentRunId) : sourceRunId ? getRun(sourceRunId) : undefined;
  const sourceJournalId =
    typeof body?.sourceJournalId === "string" && body.sourceJournalId.trim()
      ? body.sourceJournalId.trim()
      : sourceRun?.sourceJournalId;

  try {
    const issue = await createIssue(title, agentRunId, charter, parentId, tags, keyResultId, teamId, {
      ...opts,
      priority,
      sourceJournalId,
      sourceRunId,
    });
    if (agentRunId) {
      markRunReviewed(agentRunId);
      if (sourceJournalId) {
        await linkJournalToIssue(sourceJournalId, issue.id, opts).catch(() => {
          // Journal 紐付けの失敗で Issue 起票自体は失敗させない。
        });
      }
    } else {
      const task = buildIssueDraftTask(title, charter);
      try {
        await startRun("Lead Agent", task, "manual", issue.id, { ...opts, sourceJournalId });
      } catch (err) {
        if (isUnconfirmedNameCandidatesError(err)) {
          parkPendingUnmaskedSend({
            id: `unmasked-start:${issue.id}:${Date.now()}`,
            kind: "start-run",
            candidates: err.candidates,
            label: "起票直後の分析送信確認",
            issueId: issue.id,
            issueTitle: title,
            agentName: "Lead Agent",
            task,
            origin: "manual",
            linkedIssueId: issue.id,
            sourceJournalId,
          });
        }
        // その他の起動失敗でもIssue起票自体は失敗させない。
      }
    }
    return NextResponse.json({ issue: toIssueView(issue) }, { status: 201 });
  } catch (err) {
    return jsonFromUnknownError(err, 400);
  }
}
