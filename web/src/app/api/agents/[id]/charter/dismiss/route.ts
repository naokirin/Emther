import { NextResponse } from "next/server";
import { clearSuggestedCharter, toRunView } from "@/lib/agent-runtime";

export async function POST(_request: Request, ctx: RouteContext<"/api/agents/[id]/charter/dismiss">) {
  const { id } = await ctx.params;
  const run = clearSuggestedCharter(id);
  if (!run) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ run: toRunView(run) });
}
