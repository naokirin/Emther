import { NextResponse } from "next/server";
import { removeKeyResult, toObjectiveView, updateKeyResult } from "@/lib/org-context-store";

export async function PATCH(request: Request, ctx: RouteContext<"/api/org/objectives/[id]/key-results/[krId]">) {
  const { id, krId } = await ctx.params;
  const body = await request.json().catch(() => null);
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  if (!title) {
    return NextResponse.json({ error: "titleは必須です" }, { status: 400 });
  }
  const objective = await updateKeyResult(id, krId, title);
  if (!objective) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ objective: toObjectiveView(objective) });
}

export async function DELETE(_request: Request, ctx: RouteContext<"/api/org/objectives/[id]/key-results/[krId]">) {
  const { id, krId } = await ctx.params;
  const objective = removeKeyResult(id, krId);
  if (!objective) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ objective: toObjectiveView(objective) });
}
