import { NextResponse } from "next/server";
import { removeTeam, updateTeam } from "@/lib/org-context-store";
import { teamPathSegments } from "@/lib/types";

export async function PATCH(request: Request, ctx: RouteContext<"/api/teams/[id]">) {
  const { id } = await ctx.params;
  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name : undefined;
  if (name !== undefined && teamPathSegments(name).length === 0) {
    return NextResponse.json({ error: "nameは必須です" }, { status: 400 });
  }
  const team = updateTeam(id, {
    name,
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
