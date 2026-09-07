import { NextResponse } from "next/server";
import { createIssue, listIssues, toIssueView } from "@/lib/issue-store";
import { markRunReviewed } from "@/lib/agent-runtime";

export async function GET() {
  return NextResponse.json({ issues: listIssues().map(toIssueView) });
}

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

  try {
    const issue = await createIssue(
      title,
      agentRunId,
      {
        why: typeof body?.why === "string" ? body.why : undefined,
        what: typeof body?.what === "string" ? body.what : undefined,
        how: typeof body?.how === "string" ? body.how : undefined,
      },
      parentId,
      tags,
    );
    if (agentRunId) markRunReviewed(agentRunId);
    return NextResponse.json({ issue: toIssueView(issue) }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
