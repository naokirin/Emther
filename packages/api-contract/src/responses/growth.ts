import { z } from "zod";
import { growSuggestionSchema } from "../entities/growth";

export const growSuggestionsResponseSchema = z.object({
  suggestions: z.array(growSuggestionSchema),
});

export const growSuggestionMutationResponseSchema = z.object({
  suggestion: growSuggestionSchema,
});

export type GrowSuggestionsResponse = z.infer<typeof growSuggestionsResponseSchema>;
export type GrowSuggestionMutationResponse = z.infer<typeof growSuggestionMutationResponseSchema>;
