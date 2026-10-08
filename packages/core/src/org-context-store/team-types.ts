export type TeamCharter = {
  mission: string;
  constraints: string;
};

export type Team = {
  id: string;
  name: string;
  members: string[];
  charter: TeamCharter;
  archived: boolean;
  managedByEm: boolean;
  aliases: string[];
  /** 外部AI向けマスクID（TEAM_n）。maskTeamNamesEnabled 時に本文へ埋める。旧データはロード時に採番。 */
  maskId?: string;
  createdAt: number;
  updatedAt: number;
};
