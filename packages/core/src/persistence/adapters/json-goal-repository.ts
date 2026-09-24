import type { GoalRepository } from "../../org-context-store/goal-repository";
import type { Goal } from "../../org-context-store/goal-types";
import { createJsonArrayDocument } from "../json-document";

const doc = createJsonArrayDocument<Goal>("goals.json");

export function createJsonGoalRepository(): GoalRepository {
  return doc;
}
