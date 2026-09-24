import type { ObservationDumpRepository } from "../../observation-dump/observation-dump-repository";
import type { ObservationDump } from "../../observation-dump/observation-dump-entity";
import { createJsonArrayDocument } from "../json-document";

const doc = createJsonArrayDocument<ObservationDump>("observation-dumps.json");

export function createJsonObservationDumpRepository(): ObservationDumpRepository {
  return doc;
}
