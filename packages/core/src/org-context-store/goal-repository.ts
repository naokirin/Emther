import type { Goal } from "./goal-types";

export type GoalRepository = {
  load(): Goal[];
  save(goals: Goal[]): void;
};
