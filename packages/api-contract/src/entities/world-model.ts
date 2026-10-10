import { z } from "zod";
import type { WorldModelElement } from "@emther/core/world-model-store";

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
