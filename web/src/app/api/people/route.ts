import { NextResponse } from "next/server";
import { registerName } from "@/lib/people-directory";
import { addPersonAlias, getPersonProfile, listPersonSummaries } from "@/lib/people-hub";

// docs/memo.md「J. Peopleを第一級ハブに」対応。
export async function GET() {
  return NextResponse.json({ people: listPersonSummaries() });
}

function parseAliases(body: Record<string, unknown> | null): string[] {
  if (!body) return [];
  if (Array.isArray(body.aliases)) {
    return [
      ...new Set(
        body.aliases
          .filter((a): a is string => typeof a === "string")
          .map((a) => a.trim())
          .filter(Boolean),
      ),
    ];
  }
  if (typeof body.alias === "string" && body.alias.trim()) {
    return [body.alias.trim()];
  }
  return [];
}

// People画面・ヘッダーのクイック追加からの直接登録。チーム非所属の人物も明示的に
// 追加できるようにする。aliases があれば同じ人物へ別名として足す（既存人物の再登録時も可）。
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "nameは必須です" }, { status: 400 });
  }

  const id = registerName(name);
  const aliases = parseAliases(body);
  for (const alias of aliases) {
    addPersonAlias(id, alias);
  }
  const person = getPersonProfile(id) ?? listPersonSummaries().find((p) => p.id === id);
  if (!person) {
    return NextResponse.json({ error: "登録に失敗しました" }, { status: 500 });
  }
  return NextResponse.json({ person }, { status: 201 });
}
