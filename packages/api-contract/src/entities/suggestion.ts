import { z } from "zod";
import type { Suggestion } from "@emther/core/types";

export const suggestionReviewStatusSchema = z.enum(["unreviewed", "in_review", "deferred", "done"]);
export const confirmPrioritySchema = z.enum(["focus", "normal", "parked"]);

// 必須フィールドを厳密に、detail / memos 等の深い optional は looseObject で許容。
export const suggestionSchema: z.ZodType<Suggestion> = z.looseObject({
  id: z.string(),
  title: z.string(),
  reviewStatus: suggestionReviewStatusSchema,
  confirmPriority: confirmPrioritySchema,
  memos: z.array(
    z.looseObject({
      id: z.string(),
      text: z.string(),
      createdAt: z.number(),
    }),
  ),
  createdAt: z.number(),
  updatedAt: z.number(),
}) as z.ZodType<Suggestion>;

export type { Suggestion };
