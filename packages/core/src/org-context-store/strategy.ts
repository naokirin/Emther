import { createOrgStrategyService } from "./strategy-domain";
import { createJsonOrgStrategyRepository } from "../persistence/adapters/json-org-strategy-repository";

export type { OrgStrategy, OrgStrategyPatch } from "./strategy-types";

const service = createOrgStrategyService(createJsonOrgStrategyRepository());

export const getOrgStrategy = service.getOrgStrategy;
export const updateOrgStrategy = service.updateOrgStrategy;
