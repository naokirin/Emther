import { Hono } from "hono";
import type { SuggestionsLinkSuggestResponse } from "@emther/api-contract";
import { suggestSuggestionStrategyLinks } from "@emther/core/link-suggest";

// 戦略未接続の提案へテーマ/KR リンク案を返す（HITL・未適用）
export const suggestionsLinkSuggestRoute = new Hono().post("/", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { suggestionIds?: string[] };
  const suggestionIds = Array.isArray(body.suggestionIds)
    ? body.suggestionIds.filter((id): id is string => typeof id === "string" && !!id)
    : undefined;

  const result = await suggestSuggestionStrategyLinks({ suggestionIds });
  const resBody = {
    suggestions: result.suggestions,
    targetCount: result.targetCount,
    source: result.source,
    fallbackReason: result.fallbackReason,
  } satisfies SuggestionsLinkSuggestResponse;
  return c.json(resBody);
});
