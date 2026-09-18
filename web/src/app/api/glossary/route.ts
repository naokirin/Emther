import { NextResponse } from "next/server";
import { addGlossaryEntry, listGlossaryEntries } from "@/lib/glossary-store";

export async function GET() {
  return NextResponse.json({ entries: listGlossaryEntries() });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const term = typeof body?.term === "string" ? body.term.trim() : "";
  const meaning = typeof body?.meaning === "string" ? body.meaning.trim() : "";
  const reading = typeof body?.reading === "string" ? body.reading.trim() : undefined;
  const category = typeof body?.category === "string" ? body.category.trim() : undefined;

  if (!term || !meaning) {
    return NextResponse.json({ error: "term と meaning は必須です" }, { status: 400 });
  }

  const entry = addGlossaryEntry({ term, reading, meaning, category });
  return NextResponse.json({ entry }, { status: 201 });
}
