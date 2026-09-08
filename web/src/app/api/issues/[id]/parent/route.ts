import { NextResponse } from "next/server";
import { createParentIssue, toIssueView } from "@/lib/issue-store";
import { buildIssueDraftTask, startRun } from "@/lib/agent-runtime";

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

  try {
    const parent = await createParentIssue(id, title, charter);
    // ユーザー依頼「Journal等からIssueを生成する際、AIエージェントチームに内容を埋めさせる」
    // 対応。上位Issueも新規に起票される「素のIssue」のため、/api/issuesのPOSTと同じく
    // Lead Agentの分析Runを自動で紐づける。
    try {
      await startRun("Lead Agent", buildIssueDraftTask(title, charter), "manual", parent.id);
    } catch {
      // AIチームの分析起動に失敗しても、Issueの起票自体は失敗させない（あくまで補助機能）。
    }
    return NextResponse.json({ issue: toIssueView(parent) }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
