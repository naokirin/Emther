import { NextResponse } from "next/server";
import { maskOptionsFromBody } from "@/app/api/name-candidate-response";
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
    const opts = maskOptionsFromBody(body);
    // 未指定時は従来どおり未マスク許可で進める（ダイアログの「このまま」）
    const run = await confirmPendingUnmaskedSend(id, {
      allowUnmaskedCandidates: opts.registerNameCandidates ? false : true,
      registerNameCandidates: opts.registerNameCandidates,
    });
    if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ run: toRunView(run) });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 409 });
  }
}
