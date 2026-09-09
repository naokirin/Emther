import { NextResponse } from "next/server";
import { registerName } from "@/lib/people-directory";
import { getPersonProfile, listPersonSummaries } from "@/lib/people-hub";

// docs/memo.md「J. Peopleを第一級ハブに」対応。
export async function GET() {
  return NextResponse.json({ people: listPersonSummaries() });
}

// People画面からの直接登録。チーム非所属の人物も明示的に追加できるようにする。
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "nameは必須です" }, { status: 400 });
  }

  const id = registerName(name);
  const person = getPersonProfile(id) ?? listPersonSummaries().find((p) => p.id === id);
  if (!person) {
    return NextResponse.json({ error: "登録に失敗しました" }, { status: 500 });
  }
  return NextResponse.json({ person }, { status: 201 });
}
