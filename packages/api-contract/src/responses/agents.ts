import { z } from "zod";
import {
  agentRunViewSchema,
  pendingAgentStartSchema,
  pendingUnmaskedSendSchema,
} from "../entities/agents";

export const agentsResponseSchema = z.object({
  runs: z.array(agentRunViewSchema),
  pendingAgentStarts: z.array(pendingAgentStartSchema),
  pendingUnmaskedSends: z.array(pendingUnmaskedSendSchema),
});

export const agentsInboxResponseSchema = z.object({
  runs: z.array(agentRunViewSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
});

export type AgentsResponse = z.infer<typeof agentsResponseSchema>;
export type AgentsInboxResponse = z.infer<typeof agentsInboxResponseSchema>;
