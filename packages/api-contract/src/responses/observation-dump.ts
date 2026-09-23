import { z } from "zod";
import { journalEntrySchema } from "../entities/journal";
import { journalNameCandidateHintSchema } from "../entities/journal-hints";
import {
  importPreviewSchema,
  importProfileSchema,
  observationDumpViewSchema,
} from "../entities/observation-dump";

export const observationDumpsResponseSchema = z.object({
  dumps: z.array(observationDumpViewSchema),
});

export const observationDumpMutationResponseSchema = z.object({
  dump: observationDumpViewSchema,
});

export const observationDumpPreviewResponseSchema = z.object({
  preview: importPreviewSchema,
  profiles: z.array(importProfileSchema),
});

export const importProfileMutationResponseSchema = z.object({
  profile: importProfileSchema,
});

export const observationDumpAcceptResponseSchema = z.object({
  dump: observationDumpViewSchema,
  entries: z.array(journalEntrySchema),
  nameCandidateSuggestions: z.array(journalNameCandidateHintSchema).optional(),
});

export type ObservationDumpsResponse = z.infer<typeof observationDumpsResponseSchema>;
export type ObservationDumpMutationResponse = z.infer<typeof observationDumpMutationResponseSchema>;
export type ObservationDumpPreviewResponse = z.infer<typeof observationDumpPreviewResponseSchema>;
export type ImportProfileMutationResponse = z.infer<typeof importProfileMutationResponseSchema>;
export type ObservationDumpAcceptResponse = z.infer<typeof observationDumpAcceptResponseSchema>;
