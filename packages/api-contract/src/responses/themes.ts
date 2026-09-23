import { z } from "zod";
import { goalLinkSuggestionSchema } from "../entities/link-suggest";
import { orgThemeSchema } from "../entities/theme";

export const themesResponseSchema = z.object({
  themes: z.array(orgThemeSchema),
});

export const themeMutationResponseSchema = z.object({
  theme: orgThemeSchema,
});

export const themesFromGoalResponseSchema = z.object({
  themes: z.array(orgThemeSchema),
});

export const themeGoalLinkSuggestResponseSchema = z.object({
  suggestions: z.array(goalLinkSuggestionSchema),
  targetCount: z.number(),
  source: z.string(),
  fallbackReason: z.string().optional(),
});

export type ThemesResponse = z.infer<typeof themesResponseSchema>;
export type ThemeMutationResponse = z.infer<typeof themeMutationResponseSchema>;
export type ThemesFromGoalResponse = z.infer<typeof themesFromGoalResponseSchema>;
export type ThemeGoalLinkSuggestResponse = z.infer<typeof themeGoalLinkSuggestResponseSchema>;
