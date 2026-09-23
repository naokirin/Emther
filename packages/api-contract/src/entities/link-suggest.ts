import { z } from "zod";
import type { GoalLinkSuggestion, SuggestionStrategyLinkSuggestion } from "@emther/core/types";

export const goalLinkSuggestionSchema: z.ZodType<GoalLinkSuggestion> = z
  .object({
    sourceKind: z.literal("theme"),
    sourceId: z.string(),
    sourceTitle: z.string(),
    goalIds: z.array(z.string()),
    rationale: z.string(),
    labels: z.object({ goals: z.array(z.string()) }).passthrough(),
  })
  .passthrough() as z.ZodType<GoalLinkSuggestion>;

export const suggestionStrategyLinkSuggestionSchema: z.ZodType<SuggestionStrategyLinkSuggestion> = z
  .object({
    suggestionId: z.string(),
    suggestionTitle: z.string(),
    themeId: z.string().nullable(),
    rationale: z.string(),
    labels: z.object({}).passthrough(),
  })
  .passthrough() as z.ZodType<SuggestionStrategyLinkSuggestion>;

export type { GoalLinkSuggestion, SuggestionStrategyLinkSuggestion };
