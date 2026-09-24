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
  createdAt: number;
  updatedAt: number;
};
