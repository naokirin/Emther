import type { OrgStrategyRepository } from "../../org-context-store/strategy-repository";
import type { OrgStrategy } from "../../org-context-store/strategy-types";
import { createJsonSingletonDocument } from "../json-document";

const doc = createJsonSingletonDocument<Partial<OrgStrategy>>("org-strategy.json", {});

export function createJsonOrgStrategyRepository(): OrgStrategyRepository {
  return {
    load: () => doc.load(),
    save: (strategy: OrgStrategy) => doc.save(strategy),
  };
}
