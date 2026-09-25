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

export const goalMutationResponseSchema = z.object({
  goal: goalSchema,
});

export const policyMutationResponseSchema = z.object({
  policy: policyEntrySchema,
});

export const orgBackgroundMutationResponseSchema = z.object({
  background: orgBackgroundEntrySchema,
});

export const reorderIdsRequestSchema = z.object({
  ids: z.array(z.string()).min(1),
});

export type GoalsResponse = z.infer<typeof goalsResponseSchema>;
export type OrgBackgroundsResponse = z.infer<typeof orgBackgroundsResponseSchema>;
export type OrgStrategyResponse = z.infer<typeof orgStrategyResponseSchema>;
export type PoliciesResponse = z.infer<typeof policiesResponseSchema>;
export type GoalMutationResponse = z.infer<typeof goalMutationResponseSchema>;
export type PolicyMutationResponse = z.infer<typeof policyMutationResponseSchema>;
export type OrgBackgroundMutationResponse = z.infer<typeof orgBackgroundMutationResponseSchema>;
export type ReorderIdsRequest = z.infer<typeof reorderIdsRequestSchema>;
