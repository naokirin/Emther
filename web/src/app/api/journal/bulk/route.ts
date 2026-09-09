import { NextResponse } from "next/server";
import { addJournalEntriesBulk, toJournalEntryView } from "@/lib/journal-store";
import { jsonFromUnknownError, parseAllowUnmaskedCandidates } from "@/app/api/name-candidate-response";

// docs/em_human_story_and_ux.md 改修依頼「まとめて記録する仕組み」対応。EMが忙しくて
// 後からまとめて書く場合に、1件ずつSubmitさせる負担を無くすための専用エンドポイント。
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const text = typeof body?.text === "string" ? body.text.trim() : "";

  if (!text) {
    return NextResponse.json({ error: "textは必須です" }, { status: 400 });
  }

  try {
    const { entries, skippedLines } = await addJournalEntriesBulk(text, {
      allowUnmaskedCandidates: parseAllowUnmaskedCandidates(body),
    });
    return NextResponse.json({ entries: entries.map(toJournalEntryView), skippedLines }, { status: 201 });
  } catch (err) {
    return jsonFromUnknownError(err);
  }
}
