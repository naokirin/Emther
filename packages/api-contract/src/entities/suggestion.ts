import { z } from "zod";
import type { Suggestion } from "@emther/core/types";

export const suggestionReviewStatusSchema = z.enum(["unreviewed", "in_review", "deferred", "done"]);
export const confirmPrioritySchema = z.enum(["focus", "normal", "parked"]);

// 必須フィールドを厳密に、detail / memos 等の深い optional は passthrough。
export const suggestionSchema: z.ZodType<Suggestion> = z
  .object({
    id: z.string(),
    title: z.string(),
    reviewStatus: suggestionReviewStatusSchema,
    confirmPriority: confirmPrioritySchema,
    memos: z.array(
      z
        .object({
          id: z.string(),
          text: z.string(),
          createdAt: z.number(),
        })
        .passthrough(),
    ),
    createdAt: z.number(),
    updatedAt: z.number(),
  })
  .passthrough() as z.ZodType<Suggestion>;

export type { Suggestion };
