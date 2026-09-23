import { z } from "zod";
import type { GlossaryEntry } from "@emther/core/glossary-store";

export const glossaryEntrySchema: z.ZodType<GlossaryEntry> = z
  .object({
    id: z.string(),
    term: z.string(),
    meaning: z.string(),
    createdAt: z.number(),
    updatedAt: z.number(),
  })
  .passthrough() as z.ZodType<GlossaryEntry>;

export type { GlossaryEntry };
