import { NextResponse } from "next/server";
import {
  getEvaluationLog,
  setEvaluationLogStatus,
  setEvaluationLogNoActionNeeded,
  clearEvaluationLogNoActionNeeded,
  toEvaluationLogView,
  type EvaluationLogStatus,
} from "@core/person-evaluation-store";

type Ctx = { params: Promise<{ id: string; logId: string }> };

// ユーザー指摘「懸念を確認したが対応不要だった、を示せず強調を減らせない」対応。
// status（provisional/confirmed/discarded）とは独立に、polarity: concernの強調だけを
// 弱める noActionNeeded を持たせる。bodyにどちらか一方だけでも、両方でも指定できる。
export async function PATCH(request: Request, ctx: Ctx) {
  const { logId } = await ctx.params;
  const body = await request.json().catch(() => null);
  const existing = getEvaluationLog(logId);
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (body?.status === undefined && body?.noActionNeeded === undefined) {
    return NextResponse.json({ error: "status または noActionNeeded のいずれかを指定してください" }, { status: 400 });
  }

  if (body?.status !== undefined) {
    const status = body.status as EvaluationLogStatus;
    if (status !== "provisional" && status !== "confirmed" && status !== "discarded") {
      return NextResponse.json({ error: "status は provisional / confirmed / discarded です" }, { status: 400 });
    }
    setEvaluationLogStatus(logId, status);
  }

  if (body?.noActionNeeded === true) {
    const note = typeof body?.noActionNeededNote === "string" ? body.noActionNeededNote : undefined;
    await setEvaluationLogNoActionNeeded(logId, note);
  } else if (body?.noActionNeeded === false) {
    clearEvaluationLogNoActionNeeded(logId);
  }

  const updated = getEvaluationLog(logId);
  return NextResponse.json({ log: toEvaluationLogView(updated!) });
}
