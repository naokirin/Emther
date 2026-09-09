import { NextResponse } from "next/server";
import {
  confirmPendingUnmaskedSend,
  dismissPendingUnmaskedSend,
  toRunView,
} from "@/lib/agent-runtime";

export async function POST(request: Request, ctx: RouteContext<"/api/agents/pending-unmasked/[id]">) {
  const { id } = await ctx.params;
  const body = await request.json().catch(() => null);
  const action = body?.action === "dismiss" ? "dismiss" : "confirm";

  if (action === "dismiss") {
    const ok = dismissPendingUnmaskedSend(id);
    if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  }

  try {
    const run = await confirmPendingUnmaskedSend(id);
    if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ run: toRunView(run) });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 409 });
  }
}
