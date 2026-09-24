// 公開ファサード。deep import `@emther/core/em-growth-store` 互換。

import { createEmGrowthService } from "./em-growth/em-growth-domain";
import { createJsonEmGrowthRepository } from "./persistence/adapters/json-em-growth-repository";

export type {
  GrowReference,
  GrowSuggestion,
  GrowSuggestionDraft,
  GrowSuggestionStatus,
} from "./em-growth/em-growth-types";
export { GROW_SUGGESTION_STATUSES } from "./em-growth/em-growth-types";

const service = createEmGrowthService(createJsonEmGrowthRepository());

export const listGrowSuggestions = service.listGrowSuggestions;
export const getGrowSuggestion = service.getGrowSuggestion;
export const createGrowSuggestions = service.createGrowSuggestions;
export const enrichGrowSuggestionReferences = service.enrichGrowSuggestionReferences;
export const setGrowSuggestionStatus = service.setGrowSuggestionStatus;
export const toGrowSuggestionView = service.toGrowSuggestionView;
