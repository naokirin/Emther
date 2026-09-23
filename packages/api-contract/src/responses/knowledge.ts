import { z } from "zod";
import { knowledgeEventSchema } from "../entities/knowledge";

export const knowledgeEventsResponseSchema = z.object({
  events: z.array(knowledgeEventSchema),
});

export const knowledgeInterpretationMutationResponseSchema = z.object({
  interpretation: knowledgeEventSchema,
});

export type KnowledgeEventsResponse = z.infer<typeof knowledgeEventsResponseSchema>;
export type KnowledgeInterpretationMutationResponse = z.infer<
  typeof knowledgeInterpretationMutationResponseSchema
>;
