// Agents Inbox の status / dismissed フィルタを URL に載せる。
import { z } from "zod";
import type { AgentStatus } from "@emther/core/agent-runtime";

const STATUS_VALUES = ["active", "queued", "yield", "idle", "error"] as const satisfies readonly AgentStatus[];

export const agentsListSearchSchema = z.object({
  status: z.enum(STATUS_VALUES).optional().catch(undefined),
  dismissed: z.enum(["1"]).optional().catch(undefined),
});

export type AgentsListSearchParams = z.infer<typeof agentsListSearchSchema>;

export type AgentsListSearchState = {
  statusFilter: AgentStatus | "";
  showDismissedRuns: boolean;
};

export function decodeAgentsListSearch(params: AgentsListSearchParams): AgentsListSearchState {
  return {
    statusFilter: params.status ?? "",
    showDismissedRuns: params.dismissed === "1",
  };
}

export function encodeAgentsListSearch(state: AgentsListSearchState): Partial<AgentsListSearchParams> {
  return {
    status: state.statusFilter || undefined,
    dismissed: state.showDismissedRuns ? "1" : undefined,
  };
}
