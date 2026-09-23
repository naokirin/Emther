import { z } from "zod";
import type { ObservationDumpView } from "@emther/core/observation-dump-types";
import type { ImportPreview, ImportProfile } from "@emther/core/observation-dump-mapping-types";

export const observationDumpViewSchema = z
  .object({
    id: z.string(),
    sourceType: z.enum(["chat_log", "meeting_log", "other_log"]),
    rawText: z.string(),
    status: z.enum([
      "received",
      "parsing",
      "draft_ready",
      "partially_accepted",
      "done",
      "discarded",
      "failed",
    ]),
    createdAt: z.number(),
    updatedAt: z.number(),
    chunkDrafts: z.array(z.object({ id: z.string() }).passthrough()),
    droppedNotes: z.array(z.string()),
  })
  .passthrough() as unknown as z.ZodType<ObservationDumpView>;

export const importProfileSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    config: z.object({}).passthrough(),
    createdAt: z.number(),
    updatedAt: z.number(),
  })
  .passthrough() as unknown as z.ZodType<ImportProfile>;

export const importPreviewSchema = z
  .object({
    suggestedSyntax: z.enum(["jsonl", "tsv", "csv", "plain"]),
    columns: z.array(z.string()),
    suggestedMapping: z.record(z.string(), z.string()),
    suggestedTsKind: z.string(),
    hasHeader: z.boolean(),
    sampleRows: z.array(z.record(z.string(), z.string())),
    rowCount: z.number(),
  })
  .passthrough() as unknown as z.ZodType<ImportPreview>;

export type { ObservationDumpView, ImportProfile, ImportPreview };
