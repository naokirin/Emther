import type { PolicyRepository } from "../../org-context-store/policy-repository";
import type { PolicyEntry } from "../../org-context-store/policy-types";
import { createJsonArrayDocument } from "../json-document";

const doc = createJsonArrayDocument<PolicyEntry>("policies.json");

export function createJsonPolicyRepository(): PolicyRepository {
  return doc;
}
