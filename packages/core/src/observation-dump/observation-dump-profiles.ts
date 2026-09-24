import { createImportProfileService } from "./import-profile-domain";
import { createJsonImportProfileRepository } from "../persistence/adapters/json-import-profile-repository";

const service = createImportProfileService(createJsonImportProfileRepository());

export const listImportProfiles = service.listImportProfiles;
export const getImportProfile = service.getImportProfile;
export const saveImportProfile = service.saveImportProfile;
export const deleteImportProfile = service.deleteImportProfile;
export const importProfileFromBody = service.importProfileFromBody;
