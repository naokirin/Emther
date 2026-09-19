import { NextResponse } from "next/server";
import { setJournalNoActionNeeded, clearJournalNoActionNeeded, toJournalEntryView } from "@core/journal-store";
import { buildSourceConsultIndex } from "@core/journal-consult-index";
import { jsonFromUnknownError } from "@/app/api/name-candidate-response";

// ユーザー指摘「確認したが対応不要だった、をEM側から示せない・UI上の強調を減らせない」対応。
// sentimentの値そのものは書き換えず、「EMが確認し対応不要と判断した」という事実だけを
// 別途記録する。内容の訂正ではないため、通常のPATCH（supersedesチェーン）とは別の
// 専用エンドポイントにし、in-placeで更新する。
export async function POST(request: Request, ctx: RouteContext<"/api/journal/[id]/no-action-needed">) {
  const { id } = await ctx.params;
  const body = await request.json().catch(() => ({}));
  const note = typeof body?.note === "string" ? body.note : undefined;
  try {
    const entry = await setJournalNoActionNeeded(id, note);
    if (!entry) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ entry: toJournalEntryView(entry, await buildSourceConsultIndex()) });
  } catch (err) {
    return jsonFromUnknownError(err);
  }
}

export async function DELETE(_request: Request, ctx: RouteContext<"/api/journal/[id]/no-action-needed">) {
  const { id } = await ctx.params;
  const entry = clearJournalNoActionNeeded(id);
  if (!entry) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ entry: toJournalEntryView(entry, await buildSourceConsultIndex()) });
}
