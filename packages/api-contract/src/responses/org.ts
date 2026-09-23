import { z } from "zod";
import {
  goalSchema,
  orgBackgroundEntrySchema,
  orgStrategySchema,
  policyEntrySchema,
} from "../entities/org";

export const goalsResponseSchema = z.object({
  goals: z.array(goalSchema),
});

export const orgBackgroundsResponseSchema = z.object({
  backgrounds: z.array(orgBackgroundEntrySchema),
});

export const orgStrategyResponseSchema = z.object({
  strategy: orgStrategySchema,
});

export const policiesResponseSchema = z.object({
  policies: z.array(policyEntrySchema),
});

export type GoalsResponse = z.infer<typeof goalsResponseSchema>;
export type OrgBackgroundsResponse = z.infer<typeof orgBackgroundsResponseSchema>;
export type OrgStrategyResponse = z.infer<typeof orgStrategyResponseSchema>;
export type PoliciesResponse = z.infer<typeof policiesResponseSchema>;
