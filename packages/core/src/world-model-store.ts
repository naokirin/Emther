import { createWorldModelService } from "./world-model/world-model-domain";
import { createJsonWorldModelRepository } from "./persistence/adapters/json-world-model-repository";

export { containsEvaluativeAttribute, WorldModelValidationError } from "./world-model/world-model-domain";
export type {
  NewWorldModelElement,
  WorldModelElement,
  WorldModelKind,
  WorldModelStatus,
} from "./world-model/world-model-types";
export {
  ELEMENT_LINK_TYPES,
  RELATIONSHIP_STANCES,
  WORLD_MODEL_KINDS,
} from "./world-model/world-model-types";

const service = createWorldModelService(createJsonWorldModelRepository());

export const getWorldModelElement = service.get;
export const listWorldModelElements = service.listCurrent;
export const listActiveWorldModelElements = service.listActive;
export const toWorldModelView = service.toView;
export const createWorldModelElement = service.create;
export const adoptWorldModelElement = service.adopt;
export const dismissWorldModelElement = service.dismiss;
export const pinWorldModelElement = service.pin;
export const unpinWorldModelElement = service.unpin;
export const annotateWorldModelElement = service.annotate;
export const reviseWorldModelElement = service.revise;
export const confirmWorldModelElement = service.confirm;
export const markStaleWorldModelElements = service.markStaleOlderThan;
