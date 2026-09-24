import type { GlossaryRepository } from "../../glossary/glossary-repository";
import type { GlossaryEntry } from "../../glossary/glossary-types";
import { createJsonArrayDocument } from "../json-document";

const doc = createJsonArrayDocument<GlossaryEntry>("glossary.json");

export function createJsonGlossaryRepository(): GlossaryRepository {
  return doc;
}
