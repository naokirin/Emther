import { z } from "zod";
import type { GoalLinkSuggestion, SuggestionStrategyLinkSuggestion } from "@emther/core/types";

export const goalLinkSuggestionSchema: z.ZodType<GoalLinkSuggestion> = z.looseObject({
  sourceKind: z.literal("theme"),
  sourceId: z.string(),
  sourceTitle: z.string(),
  goalIds: z.array(z.string()),
  rationale: z.string(),
  labels: z.looseObject({ goals: z.array(z.string()) }),
}) as z.ZodType<GoalLinkSuggestion>;

export const suggestionStrategyLinkSuggestionSchema: z.ZodType<SuggestionStrategyLinkSuggestion> =
  z.looseObject({
    suggestionId: z.string(),
    suggestionTitle: z.string(),
    themeId: z.string().nullable(),
    rationale: z.string(),
    labels: z.looseObject({}),
  }) as z.ZodType<SuggestionStrategyLinkSuggestion>;

export type { GoalLinkSuggestion, SuggestionStrategyLinkSuggestion };
