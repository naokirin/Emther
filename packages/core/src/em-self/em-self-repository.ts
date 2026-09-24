import type { EmCheckin, EmReflectionNote } from "./em-self-types";

export type EmSelfRepository = {
  loadCheckins(): EmCheckin[];
  saveCheckins(checkins: EmCheckin[]): void;
  loadReflectionNotes(): EmReflectionNote[];
  saveReflectionNotes(notes: EmReflectionNote[]): void;
};
