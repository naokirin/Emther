import { z } from "zod";
import {
  agentRunViewSchema,
  pendingAgentStartSchema,
  pendingUnmaskedSendSchema,
} from "../entities/agents";
import { orgThemeSchema } from "../entities/theme";

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

export const agentRunMutationResponseSchema = z.object({
  run: agentRunViewSchema,
});

export const agentThemesAdoptResponseSchema = z.object({
  run: agentRunViewSchema,
  themes: z.array(orgThemeSchema),
});

export const agentSuggestionUpdatesResponseSchema = z.object({
  run: agentRunViewSchema,
  applied: z.array(
    z
      .object({
        suggestionId: z.string(),
        reason: z.string(),
      })
      .passthrough(),
  ),
  skipped: z.array(z.string()),
});

export const agentSuggestionNotesResponseSchema = z.object({
  run: agentRunViewSchema,
  written: z.array(
    z
      .object({
        suggestionId: z.string(),
        text: z.string(),
      })
      .passthrough(),
  ),
  skipped: z.array(z.string()),
});

export type AgentsResponse = z.infer<typeof agentsResponseSchema>;
export type AgentsInboxResponse = z.infer<typeof agentsInboxResponseSchema>;
export type AgentRunMutationResponse = z.infer<typeof agentRunMutationResponseSchema>;
export type AgentThemesAdoptResponse = z.infer<typeof agentThemesAdoptResponseSchema>;
export type AgentSuggestionUpdatesResponse = z.infer<typeof agentSuggestionUpdatesResponseSchema>;
export type AgentSuggestionNotesResponse = z.infer<typeof agentSuggestionNotesResponseSchema>;
