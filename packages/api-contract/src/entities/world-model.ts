import { z } from "zod";
import type { WorldModelElement, WorldModelUpdate } from "@emther/core/world-model-store";

const partySchema = z.object({ type: z.enum(["team", "person"]), id: z.string() });

export const worldModelElementSchema: z.ZodType<WorldModelElement> = z.looseObject({
  id: z.string(),
  kind: z.enum([
    "structure",
    "flow",
    "dependency",
    "dynamic",
    "condition",
    "external",
    "risk",
    "relationship",
    "gap",
  ]),
  title: z.string(),
  statement: z.string(),
  teamIds: z.array(z.string()),
  personIds: z.array(z.string()),
  relationship: z
    .object({
      parties: z.tuple([partySchema, partySchema]),
      aspect: z.enum(["work", "psychological"]),
      stance: z.enum([
        "collaboration",
        "handoff",
        "decision_rights",
        "information_flow",
        "trust",
        "tension",
        "psychological_safety",
        "alignment",
      ]),
    })
    .optional(),
  intentRefs: z.array(z.string()),
  links: z.array(
    z.object({
      toId: z.string(),
      type: z.enum(["depends_on", "influences", "conflicts_with", "explains", "gap_between"]),
    }),
  ),
  evidence: z.object({
    eventIds: z.array(z.string()),
    journalIds: z.array(z.string()),
    suggestionIds: z.array(z.string()),
    themeIds: z.array(z.string()),
  }),
  confidence: z.enum(["low", "mid", "high"]),
  status: z.enum(["candidate", "adopted", "pinned", "dismissed", "stale"]),
  origin: z.enum(["ai", "user"]),
  firstObservedAt: z.number(),
  lastConfirmedAt: z.number(),
  createdAt: z.number(),
  updatedAt: z.number(),
}) as z.ZodType<WorldModelElement>;

export type { WorldModelElement };

const evidenceSchema = z.object({
  eventIds: z.array(z.string()),
  journalIds: z.array(z.string()),
  suggestionIds: z.array(z.string()),
  themeIds: z.array(z.string()),
});

export const worldModelUpdateSchema: z.ZodType<WorldModelUpdate> = z.looseObject({
  id: z.string(),
  targetId: z.string(),
  action: z.enum(["confirm", "contradict", "refine", "stale"]),
  reason: z.string(),
  statement: z.string().optional(),
  evidence: evidenceSchema,
  status: z.enum(["pending", "applied", "dismissed"]),
  createdAt: z.number(),
}) as z.ZodType<WorldModelUpdate>;

export type { WorldModelUpdate };
