import { z } from "zod";
import type { JournalEntry } from "@emther/core/types";

// 必須フィールドを厳密に、深い optional は looseObject で許容（フル忠実はコスト高）。
export const journalEntrySchema: z.ZodType<JournalEntry> = z.looseObject({
  id: z.string(),
  rawText: z.string(),
  tags: z.array(z.string()),
  people: z.array(z.string()),
  teamIds: z.array(z.string()),
  urgency: z.enum(["low", "mid", "high"]),
  sentiment: z.enum(["positive", "negative", "neutral"]),
  summary: z.string(),
  createdAt: z.number(),
  confirmed: z.boolean(),
}) as z.ZodType<JournalEntry>;

export type { JournalEntry };
