import { registerTeamNameCollisionChecker } from "../people-directory";
import { teamPathSegments } from "../types";
import { createTeamService } from "./team-domain";
import { createJsonTeamRepository } from "../persistence/adapters/json-team-repository";

export type { Team, TeamCharter } from "./team-types";

const service = createTeamService(createJsonTeamRepository());

export const listTeams = service.listTeams;
export const listActiveTeams = service.listActiveTeams;
export const getTeam = service.getTeam;
export const toTeamView = service.toTeamView;
export const teamMatchLabels = service.teamMatchLabels;
export const findMentionedTeamIds = service.findMentionedTeamIds;
export const resolveTeamIdsByLabels = service.resolveTeamIdsByLabels;
export const filterValidTeamIds = service.filterValidTeamIds;
export const addTeam = service.addTeam;
export const updateTeam = service.updateTeam;
export const setTeamArchived = service.setTeamArchived;
export const removeTeam = service.removeTeam;
export const reassignPersonIdInTeams = service.reassignPersonIdInTeams;

// people-directory⇄org-context-storeの循環参照を避けるため、人名候補検出の
// 「チーム名との衝突チェック」はファサードから登録する。
registerTeamNameCollisionChecker((candidate) =>
  listTeams().some((t) => t.name === candidate || teamPathSegments(t.name).includes(candidate)),
);
