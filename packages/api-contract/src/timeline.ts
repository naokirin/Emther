import { z } from "zod";

// packages/core/src/timeline.ts の TimelineEntry と揃える（API の正）。
// types.ts 側にも同名型があるが、HTTP レスポンスは timeline ストア由来。
export const timelineEntityTypeSchema = z.enum(["journal", "person", "team", "suggestion", "org"]);

export const timelineEntrySchema = z.object({
  id: z.string(),
  entityType: timelineEntityTypeSchema,
  entityId: z.string().optional(),
  entityLabel: z.string().optional(),
  href: z.string().optional(),
  text: z.string(),
  occurredAt: z.number(),
});

export const timelineResponseSchema = z.object({
  entries: z.array(timelineEntrySchema),
});

export type TimelineEntry = z.infer<typeof timelineEntrySchema>;
export type TimelineResponse = z.infer<typeof timelineResponseSchema>;
