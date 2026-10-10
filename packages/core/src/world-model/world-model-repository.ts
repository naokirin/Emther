import type { WorldModelElement } from "./world-model-types";

export type WorldModelRepository = {
  load(): WorldModelElement[];
  save(elements: WorldModelElement[]): void;
};
