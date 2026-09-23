import { z } from "zod";
import { agentRunViewSchema } from "../entities/agents";
import { reportSchema } from "../entities/report";

export const reportsResponseSchema = z.object({
  reports: z.array(reportSchema),
});

export const reportMutationResponseSchema = z.object({
  report: reportSchema,
});

export const reportReviewResponseSchema = z.object({
  report: reportSchema,
  run: agentRunViewSchema,
});

export type ReportsResponse = z.infer<typeof reportsResponseSchema>;
export type ReportMutationResponse = z.infer<typeof reportMutationResponseSchema>;
export type ReportReviewResponse = z.infer<typeof reportReviewResponseSchema>;
