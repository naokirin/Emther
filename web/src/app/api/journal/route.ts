import { NextResponse } from "next/server";
import { addJournalEntry, listJournalEntries, toJournalEntryView } from "@/lib/journal-store";
import { dateStringToNoonTimestamp } from "@/lib/journal-date-parser";

export async function GET() {
  return NextResponse.json({ entries: listJournalEntries().map(toJournalEntryView) });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const text = typeof body?.text === "string" ? body.text.trim() : "";

  if (!text) {
    return NextResponse.json({ error: "textは必須です" }, { status: 400 });
  }

  // docs/em_human_story_and_ux.md 改修依頼「通常投入でも日付レベルの訂正を検討」対応。
  // occurredAtDateは"YYYY-MM-DD"（日付レベルのみ・時刻は求めない）。省略時はこれまで通り
  // Date.now()（＝今日）を使う。
  let occurredAt: number | undefined;
  if (typeof body?.occurredAtDate === "string" && body.occurredAtDate) {
    occurredAt = dateStringToNoonTimestamp(body.occurredAtDate);
    if (occurredAt === undefined) {
      return NextResponse.json({ error: "occurredAtDateの形式が不正です（YYYY-MM-DD）" }, { status: 400 });
    }
  }

  try {
    const entry = occurredAt !== undefined ? await addJournalEntry(text, occurredAt) : await addJournalEntry(text);
    return NextResponse.json({ entry: toJournalEntryView(entry) }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
