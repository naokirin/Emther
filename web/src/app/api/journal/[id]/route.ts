import { NextResponse } from "next/server";
import { toJournalEntryView, updateJournalEntry } from "@/lib/journal-store";

// docs/memo.md「C. Journalセンシング→行動」対応。AI抽出（tags/people/urgency）を
// EMがその場で校正するためのエンドポイント。内部的には新しいイベントをsupersedesで
// 繋いで記録するだけで、元のジャーナルは削除・上書きしない。
export async function PATCH(request: Request, ctx: RouteContext<"/api/journal/[id]">) {
  const { id } = await ctx.params;
  const body = await request.json().catch(() => null);

  const entry = await updateJournalEntry(id, {
    tags: Array.isArray(body?.tags) ? body.tags.filter((t: unknown): t is string => typeof t === "string") : undefined,
    people: Array.isArray(body?.people)
      ? body.people.filter((p: unknown): p is string => typeof p === "string")
      : undefined,
    urgency: body?.urgency === "low" || body?.urgency === "mid" || body?.urgency === "high" ? body.urgency : undefined,
  });
  if (!entry) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ entry: toJournalEntryView(entry) });
}
