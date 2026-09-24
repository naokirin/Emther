import { createThemeService } from "./theme/theme-domain";
import { createJsonThemeRepository } from "./persistence/adapters/json-theme-repository";

export type { OrgTheme, SuggestedTheme, ThemeStatus } from "./theme/theme-types";

const service = createThemeService(createJsonThemeRepository());

export const listThemes = service.listThemes;
export const listAdoptedThemes = service.listAdoptedThemes;
export const getTheme = service.getTheme;
export const toThemeView = service.toThemeView;
export const createTheme = service.createTheme;
export const createThemeCandidate = service.createThemeCandidate;
export const updateThemeLinks = service.updateThemeLinks;
export const adoptTheme = service.adoptTheme;
export const dismissTheme = service.dismissTheme;
export const reviseTheme = service.reviseTheme;
export const listCurrentThemes = service.listCurrentThemes;
