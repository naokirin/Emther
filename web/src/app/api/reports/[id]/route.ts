import { NextResponse } from "next/server";
import { toReportView, updateReportNote } from "@/lib/report-store";

// レポート生成後にEMが所感を書き足すための唯一の更新経路。stats（集計スナップショット）
// 自体は再生成しない限り変更できない（生成時点の観測結果として固定する）。
export async function PATCH(request: Request, ctx: RouteContext<"/api/reports/[id]">) {
  const { id } = await ctx.params;
  const body = await request.json().catch(() => null);
  const note = typeof body?.note === "string" ? body.note : undefined;
  if (note === undefined) {
    return NextResponse.json({ error: "noteは必須です" }, { status: 400 });
  }
  const report = await updateReportNote(id, note);
  if (!report) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ report: toReportView(report) });
}
