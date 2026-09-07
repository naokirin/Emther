import { NextResponse } from "next/server";
import { addReflectionNote, listReflectionNotes, toReflectionNoteView } from "@/lib/em-self-store";

// 改修依頼「週次振り返りを『思いついたときに書き込み、レポートの週次で振り返る』
// 仕組みに」対応。1回のPOST＝1件のKeep/Problem/Tryメモ。週単位のグルーピングは
// growth/page.tsx側で行う（サーバー側は個々のメモを時系列で持つだけ）。
export async function GET() {
  return NextResponse.json({ notes: listReflectionNotes().map(toReflectionNoteView) });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const type = body?.type;
  if (type !== "keep" && type !== "problem" && type !== "try") {
    return NextResponse.json({ error: "typeはkeep/problem/tryのいずれかである必要があります" }, { status: 400 });
  }
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) {
    return NextResponse.json({ error: "textは必須です" }, { status: 400 });
  }
  const note = await addReflectionNote({ type, text });
  return NextResponse.json({ note: toReflectionNoteView(note) }, { status: 201 });
}
