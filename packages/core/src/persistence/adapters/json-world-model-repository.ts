import type { WorldModelRepository } from "../../world-model/world-model-repository";
import type { WorldModelElement } from "../../world-model/world-model-types";
import { createJsonArrayDocument } from "../json-document";

const doc = createJsonArrayDocument<WorldModelElement>("world-model.json");

export function createJsonWorldModelRepository(): WorldModelRepository {
  return {
    load: () => doc.load(),
    save: (elements) => doc.save(elements),
  };
}
