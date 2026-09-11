import { NextResponse } from "next/server";
import {
  getEvaluationLog,
  setEvaluationLogStatus,
  toEvaluationLogView,
  type EvaluationLogStatus,
} from "@/lib/person-evaluation-store";

type Ctx = { params: Promise<{ id: string; logId: string }> };

export async function PATCH(request: Request, ctx: Ctx) {
  const { logId } = await ctx.params;
  const body = await request.json().catch(() => null);
  const status = body?.status as EvaluationLogStatus | undefined;
  if (status !== "provisional" && status !== "confirmed" && status !== "discarded") {
    return NextResponse.json({ error: "status は provisional / confirmed / discarded です" }, { status: 400 });
  }
  const existing = getEvaluationLog(logId);
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  const updated = setEvaluationLogStatus(logId, status);
  return NextResponse.json({ log: toEvaluationLogView(updated!) });
}
