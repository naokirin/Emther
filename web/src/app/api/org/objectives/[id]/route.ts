import { NextResponse } from "next/server";
import { removeObjective, updateObjective, toObjectiveView } from "@/lib/org-context-store";

export async function PATCH(request: Request, ctx: RouteContext<"/api/org/objectives/[id]">) {
  const { id } = await ctx.params;
  const body = await request.json().catch(() => null);
  const hasTitle = typeof body?.title === "string";
  const hasTeamId = !!body && "teamId" in body;
  const hasNote = !!body && "note" in body;
  if (!hasTitle && !hasTeamId && !hasNote) {
    return NextResponse.json({ error: "title・teamId・noteのいずれかが必要です" }, { status: 400 });
  }
  const title = hasTitle ? body.title : undefined;
  // teamId: 未指定キー＝変更しない、null／空文字＝組織全体の目標に戻す、文字列＝そのチームの目標にする。
  const teamId = hasTeamId ? (typeof body.teamId === "string" && body.teamId ? body.teamId : null) : undefined;
  // note: 未指定キー＝変更しない、null／空文字＝クリア、文字列＝設定。
  const note = hasNote ? (typeof body.note === "string" ? body.note : null) : undefined;
  const objective = await updateObjective(id, { title, teamId, note });
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
