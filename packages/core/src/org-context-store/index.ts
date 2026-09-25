// lib/org-context-store.ts のモジュール分割によるバレル。公開APIは分割前と完全に同じ名前・
// シグネチャを維持する（呼び出し側は "@core/org-context-store" というパスaliasを使っており、
// ディレクトリ化してもこのパスは解決されるため変更不要）。
// Team/Strategy/Standing Backgroundという独立したサブドメインの寄せ集めだったため、
// それぞれ別ファイルへ分割した。互いに依存し合っていないので循環参照は発生しない。

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

export type { Goal, GoalHorizon, GoalStatus } from "./goals";
export {
  addGoal,
  getGoal,
  listActiveGoals,
  listGoals,
  removeGoal,
  reorderGoals,
  toGoalView,
  updateGoal,
} from "./goals";
export { childGoalIds, normalizeIdList, resolveParentGoalIds, wouldCreateGoalCycle, buildGoalForest } from "./goal-hierarchy";
export type { GoalForestNode } from "./goal-hierarchy";

export type { NewPolicyInput, PolicyCategory, PolicyEntry } from "./policies";
export {
  addPolicy,
  getPolicy,
  listActivePolicies,
  listPolicies,
  removePolicy,
  reorderPolicies,
  toPolicyView,
  updatePolicy,
} from "./policies";
