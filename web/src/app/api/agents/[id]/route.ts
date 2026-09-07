import { NextResponse } from "next/server";
import { getRun, toRunView } from "@/lib/agent-runtime";

export async function GET(_request: Request, ctx: RouteContext<"/api/agents/[id]">) {
  const { id } = await ctx.params;
  const run = getRun(id);
  if (!run) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ run: toRunView(run) });
}
