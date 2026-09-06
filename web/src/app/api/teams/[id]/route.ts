import { NextResponse } from "next/server";
import { removeTeam, updateTeam } from "@/lib/org-context-store";

export async function PATCH(request: Request, ctx: RouteContext<"/api/teams/[id]">) {
  const { id } = await ctx.params;
  const body = await request.json().catch(() => null);
  const team = updateTeam(id, {
    name: typeof body?.name === "string" ? body.name : undefined,
    members: Array.isArray(body?.members)
      ? body.members.filter((m: unknown): m is string => typeof m === "string")
      : undefined,
  });
  if (!team) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ team });
}

export async function DELETE(_request: Request, ctx: RouteContext<"/api/teams/[id]">) {
  const { id } = await ctx.params;
  const removed = removeTeam(id);
  if (!removed) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
