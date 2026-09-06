import { NextResponse } from "next/server";
import { markRunReviewed } from "@/lib/agent-runtime";

export async function POST(_request: Request, ctx: RouteContext<"/api/agents/[id]/review">) {
  const { id } = await ctx.params;
  const run = markRunReviewed(id);
  if (!run) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ run });
}
