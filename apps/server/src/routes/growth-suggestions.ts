import { Hono } from "hono";
import type { GrowSuggestionMutationResponse, GrowSuggestionsResponse } from "@emther/api-contract";
import {
  GROW_SUGGESTION_STATUSES,
  listGrowSuggestions,
  setGrowSuggestionStatus,
  toGrowSuggestionView,
  type GrowSuggestionStatus,
} from "@emther/core/em-growth-store";

export const growthSuggestionsRoute = new Hono()
  .get("/", (c) => {
    const body = { suggestions: listGrowSuggestions().map(toGrowSuggestionView) } satisfies GrowSuggestionsResponse;
    return c.json(body);
  })
  .patch("/:id", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => null);
    const status = body?.status;
    if (typeof status !== "string" || !GROW_SUGGESTION_STATUSES.includes(status as GrowSuggestionStatus)) {
      return c.json({ error: "statusはunread/acknowledged/dismissedのいずれかである必要があります" }, 400);
    }
    const updated = setGrowSuggestionStatus(id, status as GrowSuggestionStatus);
    if (!updated) {
      return c.json({ error: "見つかりません" }, 404);
    }
    const resBody = { suggestion: toGrowSuggestionView(updated) } satisfies GrowSuggestionMutationResponse;
    return c.json(resBody);
  });
