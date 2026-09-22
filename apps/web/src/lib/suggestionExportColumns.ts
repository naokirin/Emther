import {
  DEFAULT_SUGGESTION_EXPORT_COLUMN_IDS,
  normalizeExportColumnIds,
  type SuggestionExportColumnId,
} from "@emther/core/suggestion-export";

export const SUGGESTION_EXPORT_COLUMNS_STORAGE_KEY = "emther-suggestion-export-columns";

export function loadSuggestionExportColumnIds(): SuggestionExportColumnId[] {
  try {
    const raw = window.localStorage.getItem(SUGGESTION_EXPORT_COLUMNS_STORAGE_KEY);
    if (!raw) return [...DEFAULT_SUGGESTION_EXPORT_COLUMN_IDS];
    return normalizeExportColumnIds(JSON.parse(raw) as unknown);
  } catch {
    return [...DEFAULT_SUGGESTION_EXPORT_COLUMN_IDS];
  }
}

export function saveSuggestionExportColumnIds(ids: SuggestionExportColumnId[]): void {
  try {
    window.localStorage.setItem(
      SUGGESTION_EXPORT_COLUMNS_STORAGE_KEY,
      JSON.stringify(normalizeExportColumnIds(ids)),
    );
  } catch {
    // localStorage 不可でもコピー自体は妨げない
  }
}
