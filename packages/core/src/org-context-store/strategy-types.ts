import type { StatementElaboration } from "../types";

export type OrgStrategy = {
  mission: string;
  missionElaboration?: string;
  vision: string;
  visionElaboration?: string;
  values: string;
  valueItems?: StatementElaboration[];
};

export type OrgStrategyPatch = {
  mission?: string;
  missionElaboration?: string | null;
  vision?: string;
  visionElaboration?: string | null;
  values?: string;
  valueItems?: StatementElaboration[] | null;
};

export const DEFAULT_STRATEGY: OrgStrategy = { mission: "", vision: "", values: "" };
