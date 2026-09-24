import type { Suggestion } from "../types";
import type { LegacyIssueRecord } from "../suggestion/suggestion-legacy";

export type SuggestionRepository = {
  /** suggestions.json（無ければ issues.json から移行して返す）。 */
  load(): Suggestion[];
  save(suggestions: Suggestion[]): void;
};

export type { LegacyIssueRecord };
