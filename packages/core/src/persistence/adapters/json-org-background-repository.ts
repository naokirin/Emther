import type { OrgBackgroundRepository } from "../../org-context-store/background-repository";
import type { OrgBackgroundEntry } from "../../org-context-store/background-types";
import { createJsonArrayDocument } from "../json-document";

const doc = createJsonArrayDocument<OrgBackgroundEntry>("org-background.json");

export function createJsonOrgBackgroundRepository(): OrgBackgroundRepository {
  return doc;
}
