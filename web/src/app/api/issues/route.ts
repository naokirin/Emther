import { NextResponse } from "next/server";
import { createIssue, listIssues } from "@/lib/issue-store";

export async function GET() {
  return NextResponse.json({ issues: listIssues() });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const agentRunId = typeof body?.agentRunId === "string" && body.agentRunId ? body.agentRunId : undefined;

  if (!title) {
    return NextResponse.json({ error: "titleは必須です" }, { status: 400 });
  }

  const issue = createIssue(title, agentRunId);
  return NextResponse.json({ issue }, { status: 201 });
}
