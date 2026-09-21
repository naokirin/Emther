import { Hono } from "hono";
import { suggestWhyNow, type WhyNowActionInput } from "@emther/core/why-now-suggest";

// docs/design/dashboard/today-tab.pen 改善案A対応。「今日やるべき3つ」のなぜ今を返す。
export const dashboardWhyNowRoute = new Hono().post("/", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { actions?: unknown };
  const raw = Array.isArray(body.actions) ? body.actions : [];
  const actions: WhyNowActionInput[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const id = typeof r.id === "string" ? r.id : "";
    const text = typeof r.text === "string" ? r.text : "";
    if (!id || !text) continue;
    const lane = r.lane === "observation" || r.lane === "maintenance" || r.lane === "decision" ? r.lane : "decision";
    const severity = r.severity === "urgent" || r.severity === "warn" ? r.severity : "warn";
    const kindLabel = typeof r.kindLabel === "string" ? r.kindLabel : "";
    const elapsedDays = typeof r.elapsedDays === "number" && Number.isFinite(r.elapsedDays) ? Math.max(0, Math.floor(r.elapsedDays)) : 0;
    actions.push({ id, text, lane, severity, kindLabel, elapsedDays });
  }

  const result = await suggestWhyNow(actions);
  return c.json({
    items: result.items,
    source: result.source,
    fallbackReason: result.fallbackReason,
  });
});
