import { NextResponse } from "next/server";
import { clearSuggestedPriority, toRunView } from "@/lib/agent-runtime";

export async function POST(_request: Request, ctx: RouteContext<"/api/agents/[id]/priority/dismiss">) {
  const { id } = await ctx.params;
  const run = clearSuggestedPriority(id);
  if (!run) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ run: toRunView(run) });
}
