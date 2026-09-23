import { z } from "zod";
import { teamSchema } from "../entities/team";

export const teamsResponseSchema = z.object({
  teams: z.array(teamSchema),
});

export const teamMutationResponseSchema = z.object({
  team: teamSchema.nullable(),
});

export const teamsBulkMutationResponseSchema = z.object({
  teams: z.array(teamSchema),
  skipped: z.array(z.string()).optional(),
});

export type TeamsResponse = z.infer<typeof teamsResponseSchema>;
export type TeamMutationResponse = z.infer<typeof teamMutationResponseSchema>;
export type TeamsBulkMutationResponse = z.infer<typeof teamsBulkMutationResponseSchema>;
