import { z } from "zod";

export const emCheckinSchema = z.object({
  id: z.string(),
  mood: z.number(),
  energy: z.number(),
  stress: z.number(),
  headroom: z.number().optional(),
  note: z.string(),
  createdAt: z.number(),
});

export const reflectionNoteTypeSchema = z.enum(["keep", "problem", "try"]);

export const emReflectionNoteSchema = z.object({
  id: z.string(),
  type: reflectionNoteTypeSchema,
  text: z.string(),
  createdAt: z.number(),
  archivedAt: z.number().optional(),
});

export type EmCheckin = z.infer<typeof emCheckinSchema>;
export type EmReflectionNote = z.infer<typeof emReflectionNoteSchema>;
