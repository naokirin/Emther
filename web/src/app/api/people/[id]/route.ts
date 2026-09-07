import { NextResponse } from "next/server";
import { getPersonProfile } from "@/lib/people-hub";
import { deletePerson } from "@/lib/people-directory";

export async function GET(_request: Request, ctx: RouteContext<"/api/people/[id]">) {
  const { id } = await ctx.params;
  const profile = getPersonProfile(id);
  if (!profile) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
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
  return NextResponse.json({ ok: true });
}
