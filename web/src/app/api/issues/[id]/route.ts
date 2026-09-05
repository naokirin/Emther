import { NextResponse } from "next/server";
import { getIssue } from "@/lib/issue-store";

export async function GET(_request: Request, ctx: RouteContext<"/api/issues/[id]">) {
  const { id } = await ctx.params;
  const issue = getIssue(id);
  if (!issue) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ issue });
}
