import { NextResponse } from "next/server";
import { setReflectionNoteArchived, toReflectionNoteView } from "@/lib/em-self-store";

// ユーザー要望「現在の改善方針が残り続けてコントロールできない」対応。
// archived=true で方針パネルから外し、false で戻す（誤操作の取り消し）。
export async function PATCH(request: Request, ctx: RouteContext<"/api/em-self/reflection-notes/[id]">) {
  const { id } = await ctx.params;
  const body = await request.json().catch(() => null);
  if (typeof body?.archived !== "boolean") {
    return NextResponse.json({ error: "archivedはbooleanである必要があります" }, { status: 400 });
  }
  const updated = setReflectionNoteArchived(id, body.archived);
  if (!updated) {
    return NextResponse.json({ error: "見つかりません" }, { status: 404 });
  }
  return NextResponse.json({ note: toReflectionNoteView(updated) });
}
