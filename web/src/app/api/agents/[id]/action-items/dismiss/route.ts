import { NextResponse } from "next/server";
import { clearSuggestedActionItems, toRunView } from "@/lib/agent-runtime";

export async function POST(_request: Request, ctx: RouteContext<"/api/agents/[id]/action-items/dismiss">) {
  const { id } = await ctx.params;
  const run = clearSuggestedActionItems(id);
  if (!run) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ run: toRunView(run) });
}
