import { createEmSelfService } from "./em-self/em-self-domain";
import { createJsonEmSelfRepository } from "./persistence/adapters/json-em-self-repository";

export type { EmCheckin, EmReflectionNote, ReflectionNoteType } from "./em-self/em-self-types";

const service = createEmSelfService(createJsonEmSelfRepository());

export const toCheckinView = service.toCheckinView;
export const toReflectionNoteView = service.toReflectionNoteView;
export const listCheckins = service.listCheckins;
export const addCheckin = service.addCheckin;
export const listReflectionNotes = service.listReflectionNotes;
export const addReflectionNote = service.addReflectionNote;
export const setReflectionNoteArchived = service.setReflectionNoteArchived;
