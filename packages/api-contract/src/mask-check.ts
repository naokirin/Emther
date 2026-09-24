import { z } from "zod";
import type { MaskCheckAiResult, MaskCheckQuickResult } from "@emther/core/mask-check";

export const maskCheckPhaseSchema = z.enum(["quick", "ai"]);

// text は厳密（文字列必須）。phase は不正値 → 未指定（ルート側で quick 既定）。
export const maskCheckPostBodySchema = z.looseObject({
  text: z.string(),
  phase: maskCheckPhaseSchema.optional().catch(undefined),
});

export type MaskCheckPostBody = z.infer<typeof maskCheckPostBodySchema>;

// 深い finding / highlight は looseObject。必須キーのみ列挙。
export const maskCheckQuickResponseSchema: z.ZodType<MaskCheckQuickResult & { phase: "quick" }> =
  z.looseObject({
    phase: z.literal("quick"),
    sourceText: z.string(),
    maskedText: z.string(),
    nameReplacements: z.array(
      z.looseObject({ from: z.string(), to: z.string(), count: z.number() }),
    ),
    unregisteredNameCandidates: z.array(z.string()),
    sensitiveFindings: z.array(
      z.looseObject({
        category: z.string(),
        excerpt: z.string(),
        match: z.string(),
        source: z.string(),
      }),
    ),
    highlights: z.array(
      z.looseObject({ start: z.number(), end: z.number(), kind: z.string(), match: z.string() }),
    ),
    truncated: z.boolean(),
    inputCharCount: z.number(),
    disclaimer: z.string(),
  }) as z.ZodType<MaskCheckQuickResult & { phase: "quick" }>;

export const maskCheckAiResponseSchema: z.ZodType<MaskCheckAiResult & { phase: "ai" }> = z.looseObject(
  {
    phase: z.literal("ai"),
    unregisteredNameCandidates: z.array(z.string()),
    sensitiveFindings: z.array(
      z.looseObject({
        category: z.string(),
        excerpt: z.string(),
        match: z.string(),
        source: z.string(),
      }),
    ),
    highlights: z.array(
      z.looseObject({ start: z.number(), end: z.number(), kind: z.string(), match: z.string() }),
    ),
    aiScopeNote: z.string(),
    aiWeak: z.boolean(),
    disclaimer: z.string(),
  },
) as z.ZodType<MaskCheckAiResult & { phase: "ai" }>;

export const maskCheckResponseSchema = z.union([maskCheckQuickResponseSchema, maskCheckAiResponseSchema]);

export type MaskCheckQuickResponse = MaskCheckQuickResult & { phase: "quick" };
export type MaskCheckAiResponse = MaskCheckAiResult & { phase: "ai" };
export type MaskCheckResponse = MaskCheckQuickResponse | MaskCheckAiResponse;
