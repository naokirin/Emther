import { z } from "zod";

export const profileCandidateSchema = z.object({
  person: z.string(),
  text: z.string(),
});

export const journalNameCandidateHintSchema = z.object({
  entryId: z.string(),
  people: z.array(z.string()),
  candidates: z.array(z.string()),
});

export type ProfileCandidate = z.infer<typeof profileCandidateSchema>;
export type JournalNameCandidateHint = z.infer<typeof journalNameCandidateHintSchema>;
