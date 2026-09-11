import { NextResponse } from "next/server";
import { addJournalEntry, listJournalEntries, toJournalEntryView, toJournalEntryViews } from "@/lib/journal-store";
import { dateStringToNoonTimestamp } from "@/lib/journal-date-parser";
import { jsonFromUnknownError, maskOptionsFromBody } from "@/app/api/name-candidate-response";

export async function GET() {
  return NextResponse.json({ entries: toJournalEntryViews(listJournalEntries()) });
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

  // 人物詳細など「このメンバーに紐づけて書く」導線向け。EMが明示した人物名は
  // NER抽出に頼らず作成時から people に入れる（未指定時は従来どおり抽出のみ）。
  const people = Array.isArray(body?.people)
    ? body.people.filter((p: unknown): p is string => typeof p === "string" && p.trim().length > 0)
    : undefined;

  const opts = { ...maskOptionsFromBody(body), ...(people && people.length > 0 ? { people } : {}) };

  try {
    const entry =
      occurredAt !== undefined
        ? await addJournalEntry(text, occurredAt, opts)
        : await addJournalEntry(text, Date.now(), opts);
    return NextResponse.json({ entry: toJournalEntryView(entry) }, { status: 201 });
  } catch (err) {
    return jsonFromUnknownError(err);
  }
}
