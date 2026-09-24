import type { TeamRepository } from "../../org-context-store/team-repository";
import type { Team } from "../../org-context-store/team-types";
import { createJsonArrayDocument } from "../json-document";

const doc = createJsonArrayDocument<Team>("teams.json");

export function createJsonTeamRepository(): TeamRepository {
  return doc;
}
