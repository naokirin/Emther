import { z } from "zod";
import type { PersonEvaluationLog, PersonProfile, PersonSummary } from "@emther/core/types";

export const personTrendSchema = z.object({
  positive: z.number(),
  negative: z.number(),
  neutral: z.number(),
});

export const personSummarySchema: z.ZodType<PersonSummary> = z
  .object({
    id: z.string(),
    name: z.string(),
    aliases: z.array(z.string()),
    teamNames: z.array(z.string()),
    trend: personTrendSchema,
    factCount: z.number(),
    isDirectReport: z.boolean(),
    isSelf: z.boolean(),
    hasConcerningSuggestion: z.boolean(),
  })
  .passthrough() as z.ZodType<PersonSummary>;

export const personProfileSchema: z.ZodType<PersonProfile> = z
  .object({
    id: z.string(),
    name: z.string(),
    aliases: z.array(z.string()),
    teamNames: z.array(z.string()),
    trend: personTrendSchema,
    factCount: z.number(),
    isDirectReport: z.boolean(),
    isSelf: z.boolean(),
    hasConcerningSuggestion: z.boolean(),
    facts: z.array(
      z
        .object({
          id: z.string(),
          text: z.string(),
          tags: z.array(z.string()),
          occurredAt: z.number(),
        })
        .passthrough(),
    ),
    interpretations: z.array(
      z
        .object({
          id: z.string(),
          text: z.string(),
          occurredAt: z.number(),
        })
        .passthrough(),
    ),
    relatedSuggestions: z.array(
      z
        .object({
          id: z.string(),
          title: z.string(),
          archived: z.boolean(),
          overview: z.string(),
          concerning: z.boolean(),
        })
        .passthrough(),
    ),
  })
  .passthrough() as z.ZodType<PersonProfile>;

export const personEvaluationLogSchema: z.ZodType<PersonEvaluationLog> = z
  .object({
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
  })
  .passthrough() as z.ZodType<PersonEvaluationLog>;

export type { PersonSummary, PersonProfile, PersonEvaluationLog };
