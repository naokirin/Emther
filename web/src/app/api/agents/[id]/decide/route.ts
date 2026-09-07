import { NextResponse } from "next/server";
import { decideRun, toRunView } from "@/lib/agent-runtime";

export async function POST(request: Request, ctx: RouteContext<"/api/agents/[id]/decide">) {
  const { id } = await ctx.params;
  const body = await request.json().catch(() => null);
  const message = typeof body?.message === "string" ? body.message.trim() : "";

  if (!message) {
    return NextResponse.json({ error: "messageは必須です" }, { status: 400 });
  }

  try {
    const run = await decideRun(id, message);
    if (!run) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return NextResponse.json({ run: toRunView(run) });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 409 });
  }
}
