import type { EmGrowthRepository } from "../../em-growth/em-growth-repository";
import type { GrowSuggestion } from "../../em-growth/em-growth-types";
import { createJsonArrayDocument } from "../json-document";

const doc = createJsonArrayDocument<GrowSuggestion>("em-growth-suggestions.json");

export function createJsonEmGrowthRepository(): EmGrowthRepository {
  return doc;
}
