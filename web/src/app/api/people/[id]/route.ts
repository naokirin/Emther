import { NextResponse } from "next/server";
import { addPersonAlias, getPersonProfile, removePersonAlias } from "@/lib/people-hub";
import { deletePerson, renamePerson } from "@/lib/people-directory";
import { reassignSelfPersonId } from "@/lib/settings-store";

export async function GET(_request: Request, ctx: RouteContext<"/api/people/[id]">) {
  const { id } = await ctx.params;
  const profile = getPersonProfile(id);
  if (!profile) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ person: profile });
}

// ユーザー要望「メンバーの表記揺れに対応できる仕組みが欲しい」対応。addAlias/removeAlias
// はどちらか一方を指定する想定（両方来た場合はaddAliasを先に処理する）。
export async function PATCH(request: Request, ctx: RouteContext<"/api/people/[id]">) {
  const { id } = await ctx.params;
  const body = await request.json().catch(() => null);
  const addAliasName = typeof body?.addAlias === "string" ? body.addAlias : undefined;
  const removeAliasName = typeof body?.removeAlias === "string" ? body.removeAlias : undefined;
  const newName = typeof body?.name === "string" ? body.name : undefined;

  if (newName !== undefined) {
    const result = renamePerson(id, newName);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  } else if (addAliasName !== undefined) {
    const result = addPersonAlias(id, addAliasName);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  } else if (removeAliasName !== undefined) {
    const removed = removePersonAlias(id, removeAliasName);
    if (!removed) return NextResponse.json({ error: "指定された別名が見つかりません" }, { status: 400 });
  } else {
    return NextResponse.json({ error: "name、addAlias、removeAliasのいずれかが必要です" }, { status: 400 });
  }

  const profile = getPersonProfile(id);
  if (!profile) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ person: profile });
}

// docs/em_human_story_and_ux.md P2-12対応。ローカルNERの誤登録をEMが確認・削除できる
// ようにする「最後の安全弁」。
export async function DELETE(_request: Request, ctx: RouteContext<"/api/people/[id]">) {
  const { id } = await ctx.params;
  const removed = deletePerson(id);
  if (!removed) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  // 利用者本人として紐付いていた場合は解除する（幽霊IDを残さない）。
  reassignSelfPersonId({ deletedId: id });
  return NextResponse.json({ ok: true });
}
