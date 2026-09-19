import { NextResponse } from "next/server";
import { PERIOD_DAYS, generateReport, listReports, toReportView, type ReportPeriodType } from "@core/report-store";

function isPeriodType(v: unknown): v is ReportPeriodType {
  return v === "week" || v === "month";
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const periodTypeParam = searchParams.get("periodType");
  const periodType = isPeriodType(periodTypeParam) ? periodTypeParam : undefined;
  return NextResponse.json({ reports: listReports(periodType).map(toReportView) });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!isPeriodType(body?.periodType)) {
    return NextResponse.json({ error: "periodTypeは week または month である必要があります" }, { status: 400 });
  }
  // docs/memo.md「自動で先週分・先月分のレポートを作ってほしい」対応。自動化（cron）ではなく、
  // 既存の「今すぐ生成」ボタンと同じ手動生成の対象期間を1つ前にずらすだけ。periodsAgo=1で
  // 「集計の基準時刻」を1期間分過去にずらし、generateReport自体は変更しない。
  const periodsAgo = Number.isInteger(body?.periodsAgo) && body.periodsAgo >= 0 ? body.periodsAgo : 0;
  const now = Date.now() - periodsAgo * PERIOD_DAYS[body.periodType as ReportPeriodType] * 24 * 60 * 60 * 1000;
  const report = generateReport(body.periodType, now);
  return NextResponse.json({ report: toReportView(report) }, { status: 201 });
}
