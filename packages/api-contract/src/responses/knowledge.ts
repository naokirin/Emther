import { z } from "zod";
import { knowledgeEventSchema } from "../entities/knowledge";

export const knowledgeEventsResponseSchema = z.object({
  events: z.array(knowledgeEventSchema),
});

export type KnowledgeEventsResponse = z.infer<typeof knowledgeEventsResponseSchema>;
