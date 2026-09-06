import { NextResponse } from "next/server";
import { getIssue, setIssueArchived } from "@/lib/issue-store";

export async function POST(request: Request, ctx: RouteContext<"/api/issues/[id]/archive">) {
  const { id } = await ctx.params;
  const body = await request.json().catch(() => null);
  const current = getIssue(id);
  if (!current) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const archived = typeof body?.archived === "boolean" ? body.archived : !current.archived;
  const issue = setIssueArchived(id, archived);
  return NextResponse.json({ issue });
}
