import { z } from "zod";
import type { ModelLoadSnapshot } from "@emther/core/model-loader";

export const modelSlotKeySchema = z.enum(["chat", "embedding"]);
export const modelLoadPhaseSchema = z.enum(["idle", "checking", "downloading", "ready", "error"]);
export const modelLoadOverallSchema = z.enum(["idle", "checking", "downloading", "ready", "error"]);

export const modelSlotSnapshotSchema = z.object({
  key: modelSlotKeySchema,
  label: z.string(),
  modelId: z.string(),
  phase: modelLoadPhaseSchema,
  progress: z.number(),
  loadedBytes: z.number().nullable(),
  totalBytes: z.number().nullable(),
  cached: z.boolean().nullable(),
  error: z.string().nullable(),
});

export const modelsStatusResponseSchema: z.ZodType<ModelLoadSnapshot> = z.object({
  overall: modelLoadOverallSchema,
  models: z.array(modelSlotSnapshotSchema),
});

export type ModelsStatusResponse = ModelLoadSnapshot;
