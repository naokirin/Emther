import { z } from "zod";
import { worldModelElementSchema, worldModelUpdateSchema } from "../entities/world-model";

export const worldModelListResponseSchema = z.object({
  elements: z.array(worldModelElementSchema),
});

export const worldModelMutationResponseSchema = z.object({
  element: worldModelElementSchema,
});

export const worldModelUpdatesResponseSchema = z.object({
  updates: z.array(worldModelUpdateSchema),
});

export const worldModelUpdateMutationResponseSchema = z.object({
  update: worldModelUpdateSchema,
  element: worldModelElementSchema.optional(),
});

export type WorldModelUpdatesResponse = z.infer<typeof worldModelUpdatesResponseSchema>;
export type WorldModelUpdateMutationResponse = z.infer<typeof worldModelUpdateMutationResponseSchema>;
export type WorldModelListResponse = z.infer<typeof worldModelListResponseSchema>;
export type WorldModelMutationResponse = z.infer<typeof worldModelMutationResponseSchema>;
