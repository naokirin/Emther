import type { Team } from "./team-types";

export type TeamRepository = {
  load(): Team[];
  save(teams: Team[]): void;
};
