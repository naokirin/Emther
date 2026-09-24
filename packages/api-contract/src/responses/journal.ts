import { z } from "zod";
import { agentRunViewSchema } from "../entities/agents";
import { journalEntrySchema } from "../entities/journal";
import { journalNameCandidateHintSchema, profileCandidateSchema } from "../entities/journal-hints";

export const journalListResponseSchema = z.object({
  entries: z.array(journalEntrySchema),
});

export const journalSearchResponseSchema = z.object({
  entries: z.array(journalEntrySchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
  facets: z.object({
    tags: z.array(z.string()),
    people: z.array(z.string()),
  }),
});

export const journalBatchStatusResponseSchema = z.object({
  pendingCount: z.number(),
});

export const journalEntryResponseSchema = z.object({
  entry: journalEntrySchema.nullable(),
});

/** POST /api/journal */
export const journalCreateResponseSchema = z.object({
  entry: journalEntrySchema,
  nameCandidates: z.array(z.string()).optional(),
  profileCandidate: profileCandidateSchema.optional(),
});

/** POST /api/journal/bulk（skippedLines は切り捨て件数） */
export const journalBulkResponseSchema = z.object({
  entries: z.array(journalEntrySchema),
  skippedLines: z.number().optional(),
  nameCandidateSuggestions: z.array(journalNameCandidateHintSchema).optional(),
});

/** POST /api/journal/:id/analyze */
export const journalAnalyzeResponseSchema = z.object({
  entry: journalEntrySchema,
  run: agentRunViewSchema,
});

/** POST /api/journal/local-summarize（modeにより question / summary） */
export const journalLocalSummarizeResponseSchema = z.looseObject({
  question: z.string().optional(),
  summary: z.string().optional(),
});

export type JournalListResponse = z.infer<typeof journalListResponseSchema>;
export type JournalSearchResponse = z.infer<typeof journalSearchResponseSchema>;
export type JournalBatchStatusResponse = z.infer<typeof journalBatchStatusResponseSchema>;
export type JournalEntryResponse = z.infer<typeof journalEntryResponseSchema>;
export type JournalCreateResponse = z.infer<typeof journalCreateResponseSchema>;
export type JournalBulkResponse = z.infer<typeof journalBulkResponseSchema>;
export type JournalAnalyzeResponse = z.infer<typeof journalAnalyzeResponseSchema>;
export type JournalLocalSummarizeResponse = z.infer<typeof journalLocalSummarizeResponseSchema>;
