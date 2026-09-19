import { Hono } from "hono";
import { suggestThemeOkrLinks } from "@emther/core/link-suggest";

// docs/2nd_architecture/plan.md フェーズ2.5（高リスク バッチ10）: web/src/app/api/themes/link/suggest/route.ts の移植。
// docs/value_hierarchy_and_flow.md §2 / §6.1。OKR未リンクの採用テーマへ Objective/KR リンク案を返す（HITL・未適用）。
export const themesLinkSuggestRoute = new Hono().post("/", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { themeIds?: string[] };
  const themeIds = Array.isArray(body.themeIds) ? body.themeIds.filter((id): id is string => typeof id === "string" && !!id) : undefined;

  const result = await suggestThemeOkrLinks({ themeIds });
  return c.json({
    suggestions: result.suggestions,
    targetCount: result.targetCount,
    source: result.source,
    fallbackReason: result.fallbackReason,
  });
});
