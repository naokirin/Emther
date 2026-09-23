import { z } from "zod";
import type { PendingAgentStart, PendingUnmaskedSend } from "@emther/core/types";

export const agentStatusSchema = z.enum(["active", "queued", "yield", "idle", "error"]);

export const agentRunOriginSchema = z.enum([
  "manual",
  "auto-anomaly",
  "auto-summary",
  "auto-suggestion-update",
  "auto-distill",
  "auto-grow",
  "auto-journal-batch",
  "auto-weekly-report",
  "auto-monthly-report",
]);

export const logLineSchema = z.object({
  ts: z.number(),
  channel: z.enum(["meta", "agent", "system"]),
  text: z.string(),
});

// toRunView が返す AgentRun の HTTP ビュー。深い optional（proposal / periodReview 等）は passthrough。
export const agentRunViewSchema = z
  .object({
    id: z.string(),
    agentName: z.string(),
    task: z.string(),
    status: agentStatusSchema,
    log: z.array(logLineSchema.passthrough()),
    totalCostUsd: z.number(),
    createdAt: z.number(),
    updatedAt: z.number(),
    origin: agentRunOriginSchema,
    reviewed: z.boolean(),
  })
  .passthrough();

export type AgentRunView = z.infer<typeof agentRunViewSchema>;

export const pendingAgentStartSchema: z.ZodType<PendingAgentStart> = z
  .object({
    id: z.string(),
    kind: z.literal("suggestion-update"),
    label: z.string(),
    firesAt: z.number(),
  })
  .passthrough() as z.ZodType<PendingAgentStart>;

export const pendingUnmaskedSendSchema: z.ZodType<PendingUnmaskedSend> = z
  .object({
    id: z.string(),
    kind: z.enum(["start-run", "decide-run"]),
    candidates: z.array(z.string()),
    label: z.string(),
  })
  .passthrough() as z.ZodType<PendingUnmaskedSend>;

export type { PendingAgentStart, PendingUnmaskedSend };
