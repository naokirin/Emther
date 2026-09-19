// lib/org-context-store.ts のモジュール分割によるバレル。公開APIは分割前と完全に同じ名前・
// シグネチャを維持する（呼び出し側は "@/lib/org-context-store" というパスaliasを使っており、
// ディレクトリ化してもこのパスは解決されるため変更不要）。
//
// Team/Strategy/Objectives・KeyResults/Standing Backgroundという4つの独立したサブドメインの
// 寄せ集めだったため、それぞれ別ファイルへ分割した。互いに依存し合っていないので
// 循環参照は発生しない。

export type { Team, TeamCharter } from "./teams";
export {
  addTeam,
  filterValidTeamIds,
  findMentionedTeamIds,
  getTeam,
  listActiveTeams,
  listTeams,
  reassignPersonIdInTeams,
  removeTeam,
  resolveTeamIdsByLabels,
  setTeamArchived,
  teamMatchLabels,
  toTeamView,
  updateTeam,
} from "./teams";

export type { OrgStrategy } from "./strategy";
export { getOrgStrategy, updateOrgStrategy } from "./strategy";

export type { KeyResult, Objective, ObjectiveImportDraft } from "./objectives";
export {
  addKeyResult,
  addObjective,
  getObjective,
  importObjectives,
  listObjectives,
  removeKeyResult,
  removeObjective,
  toObjectiveView,
  updateKeyResult,
  updateObjective,
} from "./objectives";

export type { NewOrgBackgroundInput, OrgBackgroundEntry, OrgBackgroundScope, OrgBackgroundStatus } from "./backgrounds";
export {
  addOrgBackground,
  getOrgBackground,
  listActiveOrgBackgrounds,
  listOrgBackgrounds,
  removeOrgBackground,
  toOrgBackgroundView,
  updateOrgBackground,
} from "./backgrounds";
