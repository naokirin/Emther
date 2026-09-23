import { z } from "zod";

/** DELETE や ack 解除など、成功のみを返すミューテーション。 */
export const okResponseSchema = z.object({
  ok: z.literal(true),
});

/** マスク解除確認待ち（202）。エージェント起動系で共通。 */
export const pendingUnmaskedResponseSchema = z.object({
  pendingUnmasked: z.literal(true),
});

/** バックアップ復元・リセット後。 */
export const dataMutationResponseSchema = z.object({
  ok: z.literal(true),
  requiresRestart: z.boolean(),
});

export type OkResponse = z.infer<typeof okResponseSchema>;
export type PendingUnmaskedResponse = z.infer<typeof pendingUnmaskedResponseSchema>;
export type DataMutationResponse = z.infer<typeof dataMutationResponseSchema>;
