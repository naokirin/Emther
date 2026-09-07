import { NextResponse } from "next/server";
import { markRunReviewed, setRunTriageStatus, toRunView } from "@/lib/agent-runtime";

export async function POST(request: Request, ctx: RouteContext<"/api/agents/[id]/review">) {
  const { id } = await ctx.params;
  const body = await request.json().catch(() => null);
  const triageStatus = body?.triageStatus === "watching" || body?.triageStatus === "dismissed" ? body.triageStatus : undefined;
  const run = triageStatus ? setRunTriageStatus(id, triageStatus) : markRunReviewed(id);
  if (!run) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ run: toRunView(run) });
}
