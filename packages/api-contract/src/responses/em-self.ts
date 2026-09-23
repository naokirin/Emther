import { z } from "zod";
import { emCheckinSchema, emReflectionNoteSchema } from "../entities/em-self";

export const emCheckinsResponseSchema = z.object({
  checkins: z.array(emCheckinSchema),
});

export const reflectionNotesResponseSchema = z.object({
  notes: z.array(emReflectionNoteSchema),
});

export type EmCheckinsResponse = z.infer<typeof emCheckinsResponseSchema>;
export type ReflectionNotesResponse = z.infer<typeof reflectionNotesResponseSchema>;
