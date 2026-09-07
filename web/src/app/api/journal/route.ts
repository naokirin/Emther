import { NextResponse } from "next/server";
import { addJournalEntry, listJournalEntries, toJournalEntryView } from "@/lib/journal-store";

export async function GET() {
  return NextResponse.json({ entries: listJournalEntries().map(toJournalEntryView) });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const text = typeof body?.text === "string" ? body.text.trim() : "";

  if (!text) {
    return NextResponse.json({ error: "textは必須です" }, { status: 400 });
  }

  try {
    const entry = await addJournalEntry(text);
    return NextResponse.json({ entry: toJournalEntryView(entry) }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
