import { NextResponse } from "next/server";
import { getPersonProfile } from "@core/people-hub";
import { acknowledgePersonIssueConcern, clearPersonIssueConcernAck } from "@core/person-concern-ack-store";

type Ctx = { params: Promise<{ id: string; issueId: string }> };

// ユーザー指摘「メンバーのアラート表示（関連Issueの停滞・ブロッカー）を確認したが
// 対応不要だった、を示せず強調を減らせない」対応。Issue自体の状態（停滞・ブロッカー）は
// 書き換えず、「この人物にとってこのIssueは対応不要と確認済み」という人物×Issue単位の
// 判断だけを記録する。
export async function PATCH(request: Request, ctx: Ctx) {
  const { id, issueId } = await ctx.params;
  const profile = getPersonProfile(id);
  if (!profile) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = await request.json().catch(() => null);
  if (body?.acknowledged === true) {
    const note = typeof body?.note === "string" ? body.note : undefined;
    const ack = await acknowledgePersonIssueConcern(profile.id, issueId, note);
    return NextResponse.json({ ack });
  }
  if (body?.acknowledged === false) {
    clearPersonIssueConcernAck(profile.id, issueId);
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "acknowledged（true/false）を指定してください" }, { status: 400 });
}
