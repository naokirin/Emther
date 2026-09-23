import { z } from "zod";
import { teamSchema } from "../entities/team";

export const teamsResponseSchema = z.object({
  teams: z.array(teamSchema),
});

export type TeamsResponse = z.infer<typeof teamsResponseSchema>;
