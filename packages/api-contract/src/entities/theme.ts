import { z } from "zod";

export const themeStatusSchema = z.enum(["candidate", "adopted", "dismissed"]);

export const orgThemeSchema = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string(),
  rationale: z.string(),
  facts: z.array(z.string()),
  rootCause: z.string().optional(),
  suggestedDirection: z.string().optional(),
  evidenceJournalIds: z.array(z.string()),
  evidenceSuggestionIds: z.array(z.string()),
  goalIds: z.array(z.string()).optional(),
  status: themeStatusSchema,
  sourceRunId: z.string().optional(),
  teamId: z.string().optional(),
  sortOrder: z.number(),
  createdAt: z.number(),
  updatedAt: z.number(),
  adoptedAt: z.number().optional(),
});

export type OrgTheme = z.infer<typeof orgThemeSchema>;
