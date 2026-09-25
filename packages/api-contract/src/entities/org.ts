import { z } from "zod";

export const statementElaborationSchema = z.object({
  statement: z.string(),
  elaboration: z.string().optional(),
});

export const orgStrategySchema = z.object({
  mission: z.string(),
  missionElaboration: z.string().optional(),
  vision: z.string(),
  visionElaboration: z.string().optional(),
  values: z.string(),
  valueItems: z.array(statementElaborationSchema).optional(),
});

export const orgBackgroundScopeSchema = z.enum(["always", "tagged"]);
export const orgBackgroundStatusSchema = z.enum(["active", "archived"]);

export const orgBackgroundEntrySchema = z.object({
  id: z.string(),
  title: z.string(),
  fact: z.string(),
  implication: z.string(),
  occurredOn: z.string().optional(),
  tags: z.array(z.string()),
  scope: orgBackgroundScopeSchema,
  status: orgBackgroundStatusSchema,
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const policyCategorySchema = z.enum(["value", "priority", "avoid", "principle", "other"]);

export const policyEntrySchema = z.object({
  id: z.string(),
  text: z.string(),
  elaboration: z.string().optional(),
  category: policyCategorySchema.optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
  archivedAt: z.number().optional(),
});

export const goalHorizonSchema = z.enum(["long", "mid", "near"]);
export const goalStatusSchema = z.enum(["active", "achieved", "abandoned"]);

export const goalSchema = z.object({
  id: z.string(),
  title: z.string(),
  elaboration: z.string().optional(),
  note: z.string().optional(),
  teamId: z.string().optional(),
  /** 上位 Goal（多対多）。チーム階層とは独立。 */
  parentGoalIds: z.array(z.string()).optional(),
  horizon: goalHorizonSchema.optional(),
  status: goalStatusSchema,
  createdAt: z.number(),
  updatedAt: z.number(),
});

export type OrgStrategy = z.infer<typeof orgStrategySchema>;
export type OrgBackgroundEntry = z.infer<typeof orgBackgroundEntrySchema>;
export type PolicyEntry = z.infer<typeof policyEntrySchema>;
export type Goal = z.infer<typeof goalSchema>;
