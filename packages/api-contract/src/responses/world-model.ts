import { z } from "zod";
import { worldModelElementSchema } from "../entities/world-model";

export const worldModelListResponseSchema = z.object({
  elements: z.array(worldModelElementSchema),
});

export const worldModelMutationResponseSchema = z.object({
  element: worldModelElementSchema,
});

export type WorldModelListResponse = z.infer<typeof worldModelListResponseSchema>;
export type WorldModelMutationResponse = z.infer<typeof worldModelMutationResponseSchema>;
