import { z } from "zod";

export const growReferenceSchema = z.object({
  topic: z.string(),
  isPrimarySource: z.boolean(),
  note: z.string().optional(),
  url: z.string().optional(),
});

export const growSuggestionStatusSchema = z.enum(["unread", "acknowledged", "dismissed"]);

export const growSuggestionSchema = z.object({
  id: z.string(),
  weekKey: z.string(),
  title: z.string(),
  rationale: z.string(),
  evidenceSummary: z.string().optional(),
  references: z.array(growReferenceSchema),
  status: growSuggestionStatusSchema,
  sourceRunId: z.string().optional(),
  generatedAt: z.number(),
});

export type GrowSuggestion = z.infer<typeof growSuggestionSchema>;
