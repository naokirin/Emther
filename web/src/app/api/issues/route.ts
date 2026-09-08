import { NextResponse } from "next/server";
import { createIssue, listIssues, toIssueView } from "@/lib/issue-store";
import { buildIssueDraftTask, markRunReviewed, startRun } from "@/lib/agent-runtime";

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
  const charter = {
    why: typeof body?.why === "string" ? body.why : undefined,
    what: typeof body?.what === "string" ? body.what : undefined,
    how: typeof body?.how === "string" ? body.how : undefined,
  };

  try {
    const issue = await createIssue(title, agentRunId, charter, parentId, tags, keyResultId, teamId);
    if (agentRunId) {
      markRunReviewed(agentRunId);
    } else {
      try {
        await startRun("Lead Agent", buildIssueDraftTask(title, charter), "manual", issue.id);
      } catch {
        // AIチームの分析起動に失敗しても、Issueの起票自体は失敗させない（あくまで補助機能）。
      }
    }
    return NextResponse.json({ issue: toIssueView(issue) }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
