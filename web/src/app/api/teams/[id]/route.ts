import { NextResponse } from "next/server";
import { removeTeam } from "@/lib/org-context-store";

export async function DELETE(_request: Request, ctx: RouteContext<"/api/teams/[id]">) {
  const { id } = await ctx.params;
  const removed = removeTeam(id);
  if (!removed) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
