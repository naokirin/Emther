import { Hono } from "hono";
import type { ThemeGoalLinkSuggestResponse } from "@emther/api-contract";
import { suggestThemeGoalLinks } from "@emther/core/link-suggest";

// 既存の themes-link-suggest と同じ HITL パターンの Goal 版。未リンクの採用テーマへ Goal 候補を提案する。
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
