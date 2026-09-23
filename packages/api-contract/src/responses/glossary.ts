import { z } from "zod";
import { glossaryEntrySchema } from "../entities/glossary";

export const glossaryListResponseSchema = z.object({
  entries: z.array(glossaryEntrySchema),
});

export const glossaryEntryMutationResponseSchema = z.object({
  entry: glossaryEntrySchema,
});

export type GlossaryListResponse = z.infer<typeof glossaryListResponseSchema>;
export type GlossaryEntryMutationResponse = z.infer<typeof glossaryEntryMutationResponseSchema>;
