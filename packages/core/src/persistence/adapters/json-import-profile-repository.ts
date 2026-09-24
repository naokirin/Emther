import type { ImportProfileRepository } from "../../observation-dump/import-profile-repository";
import type { ImportProfile } from "../../observation-dump/observation-dump-mapping-types";
import { createJsonArrayDocument } from "../json-document";

const doc = createJsonArrayDocument<ImportProfile>("observation-import-profiles.json");

export function createJsonImportProfileRepository(): ImportProfileRepository {
  return doc;
}
