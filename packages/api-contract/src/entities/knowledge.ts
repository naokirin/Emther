import { z } from "zod";

// GET /api/knowledge/events のクライアント向け必須フィールド（types.KnowledgeEvent）＋
// ストアが返す追加フィールドは looseObject で許容。
export const knowledgeEventSchema = z.looseObject({
  id: z.string(),
  kind: z.enum(["fact", "interpretation"]),
  context: z.enum(["official", "observation", "casual", "complaint", "profile"]),
  text: z.string(),
  tags: z.array(z.string()),
  occurredAt: z.number(),
  recordedAt: z.number(),
});

export type KnowledgeEvent = z.infer<typeof knowledgeEventSchema>;
