import { z } from "zod";
import type { PersonEvaluationLog, PersonProfile, PersonSummary } from "@emther/core/types";

export const personTrendSchema = z.object({
  positive: z.number(),
  negative: z.number(),
  neutral: z.number(),
});

export const personSummarySchema: z.ZodType<PersonSummary> = z.looseObject({
  id: z.string(),
  name: z.string(),
  aliases: z.array(z.string()),
  teamNames: z.array(z.string()),
  trend: personTrendSchema,
  factCount: z.number(),
  isDirectReport: z.boolean(),
  isSelf: z.boolean(),
  hasConcerningSuggestion: z.boolean(),
  archived: z.boolean(),
}) as z.ZodType<PersonSummary>;

export const personProfileSchema: z.ZodType<PersonProfile> = z.looseObject({
  id: z.string(),
  name: z.string(),
  aliases: z.array(z.string()),
  teamNames: z.array(z.string()),
  trend: personTrendSchema,
  factCount: z.number(),
  isDirectReport: z.boolean(),
  isSelf: z.boolean(),
  hasConcerningSuggestion: z.boolean(),
  archived: z.boolean(),
  facts: z.array(
    z.looseObject({
      id: z.string(),
      text: z.string(),
      tags: z.array(z.string()),
      occurredAt: z.number(),
    }),
  ),
  interpretations: z.array(
    z.looseObject({
      id: z.string(),
      text: z.string(),
      occurredAt: z.number(),
    }),
  ),
  relatedSuggestions: z.array(
    z.looseObject({
      id: z.string(),
      title: z.string(),
      archived: z.boolean(),
      overview: z.string(),
      concerning: z.boolean(),
    }),
  ),
}) as z.ZodType<PersonProfile>;

export const personEvaluationLogSchema: z.ZodType<PersonEvaluationLog> = z.looseObject({
  id: z.string(),
  personId: z.string(),
  lens: z.enum(["outcome", "value"]),
  status: z.enum(["provisional", "confirmed", "discarded"]),
  polarity: z.enum(["positive", "concern"]),
  sourceJournalId: z.string(),
  snapshotText: z.string(),
  rationale: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
}) as z.ZodType<PersonEvaluationLog>;

export type { PersonSummary, PersonProfile, PersonEvaluationLog };
