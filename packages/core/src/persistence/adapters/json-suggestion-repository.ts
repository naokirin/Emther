import { existsSync } from "node:fs";
import { dataFilePath, loadJSON, peekJSON, saveJSON } from "../persistence";
import type { Suggestion } from "../../types";
import type { LegacyIssueRecord } from "../../suggestion/suggestion-legacy";
import type { SuggestionRepository } from "../../suggestion/suggestion-repository";
import { migrateLegacyIssueToSuggestion, normalizeSuggestion } from "../../suggestion/suggestion-normalize";

export function createJsonSuggestionRepository(): SuggestionRepository {
  return {
    load(): Suggestion[] {
      if (
        existsSync(dataFilePath("suggestions.json")) ||
        peekJSON<Suggestion[]>("suggestions.json") !== undefined
      ) {
        return loadJSON<Suggestion[]>("suggestions.json", []).map(normalizeSuggestion);
      }
      const legacy = loadJSON<LegacyIssueRecord[]>("issues.json", []);
      const migrated = legacy.map(migrateLegacyIssueToSuggestion);
      if (migrated.length > 0 || legacy.length === 0) {
        saveJSON("suggestions.json", migrated, { allowEmpty: true });
      }
      return migrated;
    },
    save(suggestions: Suggestion[]): void {
      saveJSON("suggestions.json", suggestions);
    },
  };
}
