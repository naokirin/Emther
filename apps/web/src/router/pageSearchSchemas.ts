// Chat / People / Teams / Growth 用の薄い search スキーマ。
// 一覧フィルタのマージスキーマは各 listSearch モジュール側に置く（循環参照回避）。
import { z } from "zod";

export const archivedFlagSearchSchema = z.object({
  archived: z.enum(["1"]).optional().catch(undefined),
});

export const chatSearchSchema = z.object({
  runId: z.string().optional(),
  journalId: z.string().optional(),
  prefill: z.string().optional(),
  archived: z.enum(["1"]).optional().catch(undefined),
});

export const peopleSearchSchema = z.object({
  person: z.string().optional(),
  archived: z.enum(["1"]).optional().catch(undefined),
});

export const teamsSearchSchema = z.object({
  focus: z.string().optional(),
  archived: z.enum(["1"]).optional().catch(undefined),
});

export const growthSearchSchema = archivedFlagSearchSchema;
