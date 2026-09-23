import { z } from "zod";
import { growSuggestionSchema } from "../entities/growth";

export const growSuggestionsResponseSchema = z.object({
  suggestions: z.array(growSuggestionSchema),
});

export type GrowSuggestionsResponse = z.infer<typeof growSuggestionsResponseSchema>;
