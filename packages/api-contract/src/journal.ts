import { z } from "zod";
import { optionalNullableString, optionalString, optionalStringArray } from "./tolerant";

// docs/2nd_architecture/plan.md フェーズ2.6 由来。
// 手書き typeof ガードの置き換え。.catch で「不正型 → 未指定」を維持する。

const journalPostBodyObject = z.object({
  text: optionalString,
  occurredAtDate: optionalString,
  people: optionalStringArray,
  teams: optionalStringArray,
  teamIds: optionalStringArray,
});

export const journalPostBodySchema = journalPostBodyObject.catch({});

// POST /bulk は text のみ。.pick() は ZodObject にしか使えないため、.catch() 前から派生。
export const journalBulkBodySchema = journalPostBodyObject.pick({ text: true }).catch({});

export const journalPatchBodySchema = z
  .object({
    rawText: optionalString,
    tags: optionalStringArray,
    people: optionalStringArray,
    teams: optionalStringArray,
    teamIds: optionalStringArray,
    urgency: z.enum(["low", "mid", "high"]).optional().catch(undefined),
    sentiment: z.enum(["positive", "negative", "neutral"]).optional().catch(undefined),
    occurredAtDate: optionalString,
    // 未指定=変更しない / null=解除 / 文字列=設定。不正型は未指定へ。
    resolvedSuggestionId: optionalNullableString,
    resolutionNote: optionalNullableString,
  })
  .catch({});

export type JournalPostBody = z.infer<typeof journalPostBodySchema>;
export type JournalBulkBody = z.infer<typeof journalBulkBodySchema>;
export type JournalPatchBody = z.infer<typeof journalPatchBodySchema>;
