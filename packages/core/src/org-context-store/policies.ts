// 公開ファサード。`org-context-store/index` および既存 import 互換。

import { createPolicyService } from "./policy-domain";
import { createJsonPolicyRepository } from "../persistence/adapters/json-policy-repository";

export type { NewPolicyInput, PolicyCategory, PolicyEntry } from "./policy-types";

const service = createPolicyService(createJsonPolicyRepository());

export const listPolicies = service.listPolicies;
export const listActivePolicies = service.listActivePolicies;
export const getPolicy = service.getPolicy;
export const addPolicy = service.addPolicy;
export const updatePolicy = service.updatePolicy;
export const removePolicy = service.removePolicy;
export const toPolicyView = service.toPolicyView;
