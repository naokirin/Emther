import { z } from "zod";
import { journalEntrySchema } from "../entities/journal";
import { suggestionSchema } from "../entities/suggestion";

export const suggestionsResponseSchema = z.object({
  suggestions: z.array(suggestionSchema),
});

export const suggestionDetailResponseSchema = z.object({
  suggestion: suggestionSchema.nullable(),
  sourceJournals: z.array(journalEntrySchema).optional(),
});

export type SuggestionsResponse = z.infer<typeof suggestionsResponseSchema>;
export type SuggestionDetailResponse = z.infer<typeof suggestionDetailResponseSchema>;
