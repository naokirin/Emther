import { NextResponse } from "next/server";
import { getIssue, updateIssueCharter } from "@/lib/issue-store";

export async function GET(_request: Request, ctx: RouteContext<"/api/issues/[id]">) {
  const { id } = await ctx.params;
  const issue = getIssue(id);
  if (!issue) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ issue });
}

export async function PATCH(request: Request, ctx: RouteContext<"/api/issues/[id]">) {
  const { id } = await ctx.params;
  const body = await request.json().catch(() => null);

  const issue = updateIssueCharter(id, {
    why: typeof body?.why === "string" ? body.why : undefined,
    what: typeof body?.what === "string" ? body.what : undefined,
    how: typeof body?.how === "string" ? body.how : undefined,
  });
  if (!issue) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ issue });
}
