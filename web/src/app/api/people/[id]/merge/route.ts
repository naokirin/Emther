import { NextResponse } from "next/server";
import { getPersonProfile, mergePersons } from "@/lib/people-hub";

// ユーザー要望「誤って複数登録されてしまったメンバーを統合する機能が欲しい」対応。
// URLの:idが統合先（残る側）、body.duplicateIdが統合元（消える側）。People詳細画面で
// 開いている人物へ、検索して選んだ別の人物を統合する、というUIの向きに合わせている。
export async function POST(request: Request, ctx: RouteContext<"/api/people/[id]/merge">) {
  const { id } = await ctx.params;
  const body = await request.json().catch(() => null);
  const duplicateId = typeof body?.duplicateId === "string" ? body.duplicateId : "";
  if (!duplicateId) {
    return NextResponse.json({ error: "duplicateIdは必須です" }, { status: 400 });
  }

  const result = mergePersons(duplicateId, id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  const profile = getPersonProfile(id);
  if (!profile) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ person: profile });
}
