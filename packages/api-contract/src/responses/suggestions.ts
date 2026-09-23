import { z } from "zod";
import { journalEntrySchema } from "../entities/journal";
import { suggestionSchema } from "../entities/suggestion";
import { suggestionStrategyLinkSuggestionSchema } from "../entities/link-suggest";

export const suggestionsResponseSchema = z.object({
  suggestions: z.array(suggestionSchema),
});

export const suggestionDetailResponseSchema = z.object({
  suggestion: suggestionSchema.nullable(),
  sourceJournals: z.array(journalEntrySchema).optional(),
});

export const suggestionMutationResponseSchema = z.object({
  suggestion: suggestionSchema,
});

export const suggestionsLinkSuggestResponseSchema = z.object({
  suggestions: z.array(suggestionStrategyLinkSuggestionSchema),
  targetCount: z.number(),
  source: z.string(),
  fallbackReason: z.string().optional(),
});

export type SuggestionsResponse = z.infer<typeof suggestionsResponseSchema>;
export type SuggestionDetailResponse = z.infer<typeof suggestionDetailResponseSchema>;
export type SuggestionMutationResponse = z.infer<typeof suggestionMutationResponseSchema>;
export type SuggestionsLinkSuggestResponse = z.infer<typeof suggestionsLinkSuggestResponseSchema>;
