import { NextResponse } from "next/server";
import { removeObjective, renameObjective, toObjectiveView } from "@/lib/org-context-store";

export async function PATCH(request: Request, ctx: RouteContext<"/api/org/objectives/[id]">) {
  const { id } = await ctx.params;
  const body = await request.json().catch(() => null);
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  if (!title) {
    return NextResponse.json({ error: "titleは必須です" }, { status: 400 });
  }
  const objective = await renameObjective(id, title);
  if (!objective) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ objective: toObjectiveView(objective) });
}

export async function DELETE(_request: Request, ctx: RouteContext<"/api/org/objectives/[id]">) {
  const { id } = await ctx.params;
  const removed = removeObjective(id);
  if (!removed) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
