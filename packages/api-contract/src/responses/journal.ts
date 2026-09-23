import { z } from "zod";
import { journalEntrySchema } from "../entities/journal";

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

export type JournalListResponse = z.infer<typeof journalListResponseSchema>;
export type JournalSearchResponse = z.infer<typeof journalSearchResponseSchema>;
export type JournalBatchStatusResponse = z.infer<typeof journalBatchStatusResponseSchema>;
export type JournalEntryResponse = z.infer<typeof journalEntryResponseSchema>;
