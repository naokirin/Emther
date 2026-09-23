import { z } from "zod";

export const teamCharterSchema = z.object({
  mission: z.string(),
  constraints: z.string(),
});

export const teamSchema = z.object({
  id: z.string(),
  name: z.string(),
  members: z.array(z.string()),
  charter: teamCharterSchema,
  archived: z.boolean(),
  managedByEm: z.boolean(),
  aliases: z.array(z.string()),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export type Team = z.infer<typeof teamSchema>;
