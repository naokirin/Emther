import { NextResponse } from "next/server";
import { createParentIssue, toIssueView } from "@/lib/issue-store";
import { buildIssueDraftTask, parkPendingUnmaskedSend, startRun } from "@/lib/agent-runtime";
import { isUnconfirmedNameCandidatesError } from "@/lib/name-candidate-confirmation";
import { jsonFromUnknownError, maskOptionsFromBody } from "@/app/api/name-candidate-response";

// 既存Issueの上位に新しいIssueを作り、既存Issueをその子として付け替える（ズームアウト）。
export async function POST(request: Request, ctx: RouteContext<"/api/issues/[id]/parent">) {
  const { id } = await ctx.params;
  const body = await request.json().catch(() => null);
  const title = typeof body?.title === "string" ? body.title.trim() : "";

  if (!title) {
    return NextResponse.json({ error: "titleは必須です" }, { status: 400 });
  }

  const charter = {
    why: typeof body?.why === "string" ? body.why : undefined,
    what: typeof body?.what === "string" ? body.what : undefined,
    how: typeof body?.how === "string" ? body.how : undefined,
  };
  const opts = maskOptionsFromBody(body);

  try {
    const parent = await createParentIssue(id, title, charter, opts);
    // ユーザー依頼「Journal等からIssueを生成する際、AIエージェントチームに内容を埋めさせる」
    // 対応。上位Issueも新規に起票される「素のIssue」のため、/api/issuesのPOSTと同じく
    // Lead Agentの分析Runを自動で紐づける。
    const task = buildIssueDraftTask(title, charter);
    try {
      await startRun("Lead Agent", task, "manual", parent.id, opts);
    } catch (err) {
      if (isUnconfirmedNameCandidatesError(err)) {
        parkPendingUnmaskedSend({
          id: `unmasked-start:${parent.id}:${Date.now()}`,
          kind: "start-run",
          candidates: err.candidates,
          label: "上位Issue起票直後の分析送信確認",
          issueId: parent.id,
          issueTitle: title,
          agentName: "Lead Agent",
          task,
          origin: "manual",
          linkedIssueId: parent.id,
        });
      }
    }
    return NextResponse.json({ issue: toIssueView(parent) }, { status: 201 });
  } catch (err) {
    return jsonFromUnknownError(err, 400);
  }
}
