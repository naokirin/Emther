import type { WorldModelUpdate } from "./world-model-update-types";

export type WorldModelUpdateRepository = {
  load(): WorldModelUpdate[];
  save(updates: WorldModelUpdate[]): void;
};
