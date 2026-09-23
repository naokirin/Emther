import { z } from "zod";

// GET /api/knowledge/events のクライアント向け必須フィールド（types.KnowledgeEvent）＋
// ストアが返す追加フィールドは passthrough。
export const knowledgeEventSchema = z
  .object({
    id: z.string(),
    kind: z.enum(["fact", "interpretation"]),
    context: z.enum(["official", "observation", "casual", "complaint", "profile"]),
    text: z.string(),
    tags: z.array(z.string()),
    occurredAt: z.number(),
    recordedAt: z.number(),
  })
  .passthrough();

export type KnowledgeEvent = z.infer<typeof knowledgeEventSchema>;
