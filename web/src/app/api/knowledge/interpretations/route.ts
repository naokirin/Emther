import { NextResponse } from "next/server";
import { recordEvent, listEvents, listInterpretationsForPerson, toEventView } from "@/lib/knowledge-store";
import { embedText } from "@/lib/embeddings";
import { getPersonId, maskForStorage, registerName } from "@/lib/people-directory";

// docs/memo.md「H: 永続化データモデルの設計」対応。「Aさんはリーダー志向がある」のような
// 長期的な解釈（プロファイル）を記録する口。Quick Journal（一時的な出来事＝fact）とは
// 意図的に分離しており、TTLを持たない（訂正されるまで有効）。

export async function GET(request: Request) {
  const person = new URL(request.url).searchParams.get("person");
  // 未登録の名前でも新規登録しない（GETは副作用を持たない）。未登録なら該当0件を返す。
  const events = person
    ? (getPersonId(person) ? listInterpretationsForPerson(getPersonId(person)!) : [])
    : listEvents({ kind: "interpretation" });
  return NextResponse.json({ interpretations: events.map(toEventView) });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const person = typeof body?.person === "string" ? body.person.trim() : "";
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  const tags = Array.isArray(body?.tags) ? body.tags.filter((t: unknown): t is string => typeof t === "string") : [];

  if (!person || !text) {
    return NextResponse.json({ error: "personとtextは必須です" }, { status: 400 });
  }

  // 個人情報の分離（ユーザー指摘対応）: peopleにはPERSON_n IDを、textはmaskForStorageで
  // マスクした状態を保存する。埋め込みはローカル生成・ローカル利用のみなので生のtextで計算する。
  const personId = registerName(person);
  let embedding: number[] | undefined;
  try {
    embedding = await embedText(text);
  } catch {
    embedding = undefined;
  }
  const maskedText = await maskForStorage(text);
  const event = recordEvent({
    kind: "interpretation",
    context: "profile",
    entityType: "person",
    people: [personId],
    text: maskedText,
    tags,
    occurredAt: Date.now(),
    embedding,
  });
  return NextResponse.json({ interpretation: toEventView(event) }, { status: 201 });
}
