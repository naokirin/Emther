import { Hono } from "hono";
import type { ThemeGoalLinkSuggestResponse } from "@emther/api-contract";
import { suggestThemeGoalLinks } from "@emther/core/link-suggest";

// docs/goal_policy_model_plan.md Decision 1 / Phase 2。既存のthemes-link-suggest.tsと同じ
// HITLパターンのGoal版。未リンクの採用テーマへGoal候補を提案する。
export const themeGoalLinkSuggestRoute = new Hono().post("/", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { ids?: string[] };
  const ids = Array.isArray(body.ids) ? body.ids.filter((id): id is string => typeof id === "string" && !!id) : undefined;

  const result = await suggestThemeGoalLinks({ ids });
  const resBody = {
    suggestions: result.suggestions,
    targetCount: result.targetCount,
    source: result.source,
    fallbackReason: result.fallbackReason,
  } satisfies ThemeGoalLinkSuggestResponse;
  return c.json(resBody);
});
