import { NextResponse } from "next/server";
import { getIssue, setIssueKeyResult, setIssueTags, setIssueTeam, toIssueView, updateIssueCharter } from "@/lib/issue-store";

export async function GET(_request: Request, ctx: RouteContext<"/api/issues/[id]">) {
  const { id } = await ctx.params;
  const issue = getIssue(id);
  if (!issue) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ issue: toIssueView(issue) });
}

export async function PATCH(request: Request, ctx: RouteContext<"/api/issues/[id]">) {
  const { id } = await ctx.params;
  const body = await request.json().catch(() => null);

  let issue = await updateIssueCharter(id, {
    why: typeof body?.why === "string" ? body.why : undefined,
    what: typeof body?.what === "string" ? body.what : undefined,
    how: typeof body?.how === "string" ? body.how : undefined,
  });
  if (!issue) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (Array.isArray(body?.tags)) {
    const tags = body.tags.filter((t: unknown): t is string => typeof t === "string");
    issue = setIssueTags(id, tags) ?? issue;
  }
  if ("keyResultId" in (body ?? {})) {
    const keyResultId = typeof body.keyResultId === "string" && body.keyResultId ? body.keyResultId : null;
    issue = setIssueKeyResult(id, keyResultId) ?? issue;
  }
  if ("teamId" in (body ?? {})) {
    const teamId = typeof body.teamId === "string" && body.teamId ? body.teamId : null;
    issue = setIssueTeam(id, teamId) ?? issue;
  }
  return NextResponse.json({ issue: toIssueView(issue) });
}
