import { z } from "zod";
import type { IdMatch } from "@emther/core/id-resolve";

export const idMatchKindSchema = z.enum(["suggestion", "journal", "run"]);

export const idMatchSchema: z.ZodType<IdMatch> = z.object({
  kind: idMatchKindSchema,
  id: z.string(),
  label: z.string(),
  href: z.string(),
});

export const idResolveResponseSchema = z.object({
  matches: z.array(idMatchSchema),
});

export type { IdMatch };
export type IdResolveResponse = z.infer<typeof idResolveResponseSchema>;
