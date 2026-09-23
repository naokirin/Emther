import { z } from "zod";

export const reportPeriodTypeSchema = z.enum(["week", "month"]);

export const reportJournalStatsSchema = z.object({
  total: z.number(),
  byUrgency: z.object({ low: z.number(), mid: z.number(), high: z.number() }),
  bySentiment: z.object({ positive: z.number(), negative: z.number(), neutral: z.number() }),
  topTags: z.array(z.object({ tag: z.string(), count: z.number() })),
  notableEntries: z.array(
    z.object({
      id: z.string(),
      summary: z.string(),
      urgency: z.string(),
      sentiment: z.string(),
      occurredAt: z.number(),
    }),
  ),
});

export const reportSuggestionStatsSchema = z.object({
  createdCount: z.number(),
  archivedCount: z.number(),
  createdTitles: z.array(z.object({ id: z.string(), title: z.string() })),
  archivedTitles: z.array(z.object({ id: z.string(), title: z.string() })),
});

export const reportEventStatsSchema = z.object({
  total: z.number(),
  byEntityType: z.record(z.string(), z.number()),
});

export const reportStatsSchema = z.object({
  journal: reportJournalStatsSchema,
  suggestions: reportSuggestionStatsSchema,
  events: reportEventStatsSchema,
});

export const reportSchema = z.object({
  id: z.string(),
  periodType: reportPeriodTypeSchema,
  periodStart: z.number(),
  periodEnd: z.number(),
  generatedAt: z.number(),
  stats: reportStatsSchema,
  note: z.string(),
});

export type Report = z.infer<typeof reportSchema>;
export type ReportPeriodType = z.infer<typeof reportPeriodTypeSchema>;
