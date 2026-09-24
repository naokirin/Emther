import type { LegacyOrgTheme, OrgTheme } from "./theme-types";

export type ThemeRepository = {
  load(): LegacyOrgTheme[];
  save(themes: OrgTheme[]): void;
};
