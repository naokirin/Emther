import { createGoalService } from "./goal-domain";
import { createJsonGoalRepository } from "../persistence/adapters/json-goal-repository";

export type { Goal, GoalHorizon, GoalStatus } from "./goal-types";

const service = createGoalService(createJsonGoalRepository());

export const listGoals = service.listGoals;
export const listActiveGoals = service.listActiveGoals;
export const getGoal = service.getGoal;
export const addGoal = service.addGoal;
export const updateGoal = service.updateGoal;
export const removeGoal = service.removeGoal;
export const reorderGoals = service.reorderGoals;
export const toGoalView = service.toGoalView;
