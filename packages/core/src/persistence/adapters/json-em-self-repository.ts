import type { EmSelfRepository } from "../../em-self/em-self-repository";
import type { EmCheckin, EmReflectionNote } from "../../em-self/em-self-types";
import { createJsonArrayDocument } from "../json-document";

const checkinsDoc = createJsonArrayDocument<EmCheckin>("em-checkins.json");
const notesDoc = createJsonArrayDocument<EmReflectionNote>("em-reflection-notes.json");

export function createJsonEmSelfRepository(): EmSelfRepository {
  return {
    loadCheckins: () => checkinsDoc.load(),
    saveCheckins: (checkins) => checkinsDoc.save(checkins),
    loadReflectionNotes: () => notesDoc.load(),
    saveReflectionNotes: (notes) => notesDoc.save(notes),
  };
}
