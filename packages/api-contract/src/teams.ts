import { z } from "zod";
import { optionalBoolean, optionalString, optionalStringArray } from "./tolerant";

// journal / settings-rules と同じ寛容方針（不正型 → 未指定）。
export const teamsPostBodySchema = z
  .object({
    name: optionalString,
    members: optionalStringArray,
    managedByEm: optionalBoolean,
  })
  .catch({});

export type TeamsPostBody = z.infer<typeof teamsPostBodySchema>;
