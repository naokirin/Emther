import { createOrgBackgroundService } from "./background-domain";
import { createJsonOrgBackgroundRepository } from "../persistence/adapters/json-org-background-repository";

export type {
  NewOrgBackgroundInput,
  OrgBackgroundEntry,
  OrgBackgroundScope,
  OrgBackgroundStatus,
} from "./background-types";

const service = createOrgBackgroundService(createJsonOrgBackgroundRepository());

export const listOrgBackgrounds = service.listOrgBackgrounds;
export const listActiveOrgBackgrounds = service.listActiveOrgBackgrounds;
export const getOrgBackground = service.getOrgBackground;
export const addOrgBackground = service.addOrgBackground;
export const updateOrgBackground = service.updateOrgBackground;
export const removeOrgBackground = service.removeOrgBackground;
export const toOrgBackgroundView = service.toOrgBackgroundView;
