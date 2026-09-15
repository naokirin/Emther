import { NextResponse } from "next/server";
import { archiveJournalEntry, unarchiveJournalEntry, toJournalEntryView } from "@/lib/journal-store";
import { buildSourceConsultIndex } from "@/lib/journal-consult-index";

// docs/memo.md「相談、Journal、提案を削除（アーカイブ）したい」対応。重複記録・誤入力等の
// Journalを、内容の訂正（PATCH・supersedesチェーン）とは別に、一覧・AIの判断材料から
// 除外する専用エンドポイント（no-action-neededと同じ思想のin-place更新）。
export async function POST(_request: Request, ctx: RouteContext<"/api/journal/[id]/archive">) {
  const { id } = await ctx.params;
  const entry = archiveJournalEntry(id);
  if (!entry) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ entry: toJournalEntryView(entry, await buildSourceConsultIndex()) });
}

export async function DELETE(_request: Request, ctx: RouteContext<"/api/journal/[id]/archive">) {
  const { id } = await ctx.params;
  const entry = unarchiveJournalEntry(id);
  if (!entry) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ entry: toJournalEntryView(entry, await buildSourceConsultIndex()) });
}
