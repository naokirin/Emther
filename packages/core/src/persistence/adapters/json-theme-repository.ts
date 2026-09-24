import type { ThemeRepository } from "../../theme/theme-repository";
import type { LegacyOrgTheme, OrgTheme } from "../../theme/theme-types";
import { createJsonArrayDocument } from "../json-document";

const doc = createJsonArrayDocument<LegacyOrgTheme>("themes.json");

export function createJsonThemeRepository(): ThemeRepository {
  return {
    load: () => doc.load(),
    save: (themes: OrgTheme[]) => doc.save(themes),
  };
}
