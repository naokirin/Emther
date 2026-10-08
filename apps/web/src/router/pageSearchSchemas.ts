// Chat / People / Teams / Growth 用の薄い search スキーマ。
// 一覧フィルタのマージスキーマは各 listSearch モジュール側に置く（循環参照回避）。
import { z } from "zod";

export const archivedFlagSearchSchema = z.object({
  archived: z.enum(["1"]).optional().catch(undefined),
});

export const CONSULT_ORIGIN_FILTERS = [
  "all",
  "manual",
  "auto-summary",
  "auto-distill",
  "journal",
  "auto-grow",
  "report",
] as const;

export type ConsultOriginFilter = (typeof CONSULT_ORIGIN_FILTERS)[number];

export const chatSearchSchema = z.object({
  runId: z.string().optional(),
  journalId: z.string().optional(),
  prefill: z.string().optional(),
  intent: z.enum(["theme"]).optional(),
  archived: z.enum(["1"]).optional().catch(undefined),
  tab: z.enum(["history", "draft"]).optional().catch(undefined),
  origin: z.enum(CONSULT_ORIGIN_FILTERS).optional().catch(undefined),
});

export const orgSearchSchema = z.object({
  section: z.enum(["themes"]).optional(),
  themeId: z.string().optional(),
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
