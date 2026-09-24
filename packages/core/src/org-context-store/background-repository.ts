import type { OrgBackgroundEntry } from "./background-types";

export type OrgBackgroundRepository = {
  load(): OrgBackgroundEntry[];
  save(entries: OrgBackgroundEntry[]): void;
};
