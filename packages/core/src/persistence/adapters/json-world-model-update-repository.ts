import type { WorldModelUpdateRepository } from "../../world-model/world-model-update-repository";
import type { WorldModelUpdate } from "../../world-model/world-model-update-types";
import { createJsonArrayDocument } from "../json-document";

const doc = createJsonArrayDocument<WorldModelUpdate>("world-model-updates.json");

export function createJsonWorldModelUpdateRepository(): WorldModelUpdateRepository {
  return {
    load: () => doc.load(),
    save: (updates) => doc.save(updates),
  };
}
