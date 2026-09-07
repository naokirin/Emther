import { NextResponse } from "next/server";
import { generateReport, listReports, toReportView, type ReportPeriodType } from "@/lib/report-store";

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
  const report = generateReport(body.periodType);
  return NextResponse.json({ report: toReportView(report) }, { status: 201 });
}
