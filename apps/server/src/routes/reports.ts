import { Hono } from "hono";
import { PERIOD_DAYS, generateReport, listReports, toReportView, updateReportNote, type ReportPeriodType } from "@emther/core/report-store";

// docs/2nd_architecture/plan.md フェーズ2.5: web/src/app/api/reports/{route,[id]/route}.ts の移植。
function isPeriodType(v: unknown): v is ReportPeriodType {
  return v === "week" || v === "month";
}

export const reportsRoute = new Hono()
  .get("/", (c) => {
    const periodTypeParam = c.req.query("periodType");
    const periodType = isPeriodType(periodTypeParam) ? periodTypeParam : undefined;
    return c.json({ reports: listReports(periodType).map(toReportView) });
  })
  .post("/", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!isPeriodType(body?.periodType)) {
      return c.json({ error: "periodTypeは week または month である必要があります" }, 400);
    }
    // docs/memo.md「自動で先週分・先月分のレポートを作ってほしい」対応。自動化（cron）ではなく、
    // 既存の「今すぐ生成」ボタンと同じ手動生成の対象期間を1つ前にずらすだけ。periodsAgo=1で
    // 「集計の基準時刻」を1期間分過去にずらし、generateReport自体は変更しない。
    const periodsAgo = Number.isInteger(body?.periodsAgo) && body.periodsAgo >= 0 ? body.periodsAgo : 0;
    const now = Date.now() - periodsAgo * PERIOD_DAYS[body.periodType as ReportPeriodType] * 24 * 60 * 60 * 1000;
    const report = generateReport(body.periodType, now);
    return c.json({ report: toReportView(report) }, 201);
  })
  .patch("/:id", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => null);
    const note = typeof body?.note === "string" ? body.note : undefined;
    if (note === undefined) {
      return c.json({ error: "noteは必須です" }, 400);
    }
    const report = await updateReportNote(id, note);
    if (!report) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json({ report: toReportView(report) });
  });
