import { NextResponse } from "next/server";
import { recordEvent, listEvents, listInterpretationsForPerson } from "@/lib/knowledge-store";
import { embedText } from "@/lib/embeddings";
import { registerName } from "@/lib/people-directory";

// docs/memo.md「H: 永続化データモデルの設計」対応。「Aさんはリーダー志向がある」のような
// 長期的な解釈（プロファイル）を記録する口。Quick Journal（一時的な出来事＝fact）とは
// 意図的に分離しており、TTLを持たない（訂正されるまで有効）。

export async function GET(request: Request) {
  const person = new URL(request.url).searchParams.get("person");
  const events = person ? listInterpretationsForPerson(person) : listEvents({ kind: "interpretation" });
  return NextResponse.json({ interpretations: events });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const person = typeof body?.person === "string" ? body.person.trim() : "";
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  const tags = Array.isArray(body?.tags) ? body.tags.filter((t: unknown): t is string => typeof t === "string") : [];

  if (!person || !text) {
    return NextResponse.json({ error: "personとtextは必須です" }, { status: 400 });
  }

  registerName(person);
  let embedding: number[] | undefined;
  try {
    embedding = await embedText(text);
  } catch {
    embedding = undefined;
  }
  const event = recordEvent({
    kind: "interpretation",
    context: "profile",
    entityType: "person",
    people: [person],
    text,
    tags,
    occurredAt: Date.now(),
    embedding,
  });
  return NextResponse.json({ interpretation: event }, { status: 201 });
}
