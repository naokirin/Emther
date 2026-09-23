import { z } from "zod";
import { reportSchema } from "../entities/report";

export const reportsResponseSchema = z.object({
  reports: z.array(reportSchema),
});

export type ReportsResponse = z.infer<typeof reportsResponseSchema>;
