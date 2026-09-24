import type { GrowSuggestion } from "./em-growth-types";

/** Grow 提案の永続化ポート。ドメインはファイル名を知らない。 */
export type EmGrowthRepository = {
  load(): GrowSuggestion[];
  save(suggestions: GrowSuggestion[]): void;
};
