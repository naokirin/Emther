import { Hono } from "hono";
import type { PendingUnmaskedResponse, ReportMutationResponse, ReportReviewResponse, ReportsResponse } from "@emther/api-contract";
import { startPeriodReviewAnalysis, toRunView } from "@emther/core/agent-runtime/index";
import { isUnconfirmedNameCandidatesError } from "@emther/core/name-candidate-confirmation";
import { PERIOD_DAYS, generateReport, listReports, toReportView, updateReportNote, type ReportPeriodType } from "@emther/core/report-store";

function isPeriodType(v: unknown): v is ReportPeriodType {
  return v === "week" || v === "month";
}

export const reportsRoute = new Hono()
  .get("/", (c) => {
    const periodTypeParam = c.req.query("periodType");
    const periodType = isPeriodType(periodTypeParam) ? periodTypeParam : undefined;
    const body = { reports: listReports(periodType).map(toReportView) } satisfies ReportsResponse;
    return c.json(body);
  })
  .post("/", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!isPeriodType(body?.periodType)) {
      return c.json({ error: "periodTypeは week または month である必要があります" }, 400);
    }
    // 既存の「今すぐ生成」ボタンと同じ手動生成の対象期間を1つ前にずらすだけ。periodsAgo=1で
    // 「集計の基準時刻」を1期間分過去にずらし、generateReport自体は変更しない
    const periodsAgo = Number.isInteger(body?.periodsAgo) && body.periodsAgo >= 0 ? body.periodsAgo : 0;
    const now = Date.now() - periodsAgo * PERIOD_DAYS[body.periodType as ReportPeriodType] * 24 * 60 * 60 * 1000;
    const report = generateReport(body.periodType, now);
    const resBody = { report: toReportView(report) } satisfies ReportMutationResponse;
    return c.json(resBody, 201);
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
    const resBody = { report: toReportView(report) } satisfies ReportMutationResponse;
    return c.json(resBody);
  })
  // Agentによる
  // 対話型レビュー（AgentRun, origin=auto-weekly-report/auto-monthly-report）も併せて起動する
  .post("/review", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!isPeriodType(body?.periodType)) {
      return c.json({ error: "periodTypeは week または month である必要があります" }, 400);
    }
    const offset = Number.isInteger(body?.offset) && body.offset >= 0 ? body.offset : 0;
    try {
      const result = await startPeriodReviewAnalysis(body.periodType as ReportPeriodType, offset, { manual: true });
      if (!result) {
        const pendingBody = { pendingUnmasked: true } satisfies PendingUnmaskedResponse;
        return c.json(pendingBody, 202);
      }
      const resBody = {
        report: toReportView(result.report),
        run: toRunView(result.run),
      } satisfies ReportReviewResponse;
      return c.json(resBody, 201);
    } catch (err) {
      if (isUnconfirmedNameCandidatesError(err)) {
        return c.json({ error: err.message, candidates: err.candidates }, 409);
      }
      return c.json({ error: (err as Error).message }, 500);
    }
  });
