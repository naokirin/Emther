import { randomUUID } from "node:crypto";
import { maskForStorage, unmaskNames } from "../people-directory";
import type { EmSelfRepository } from "./em-self-repository";
import type { EmCheckin, EmReflectionNote, ReflectionNoteType } from "./em-self-types";

function clampScale(v: number): number {
  return Math.min(5, Math.max(1, Math.round(v)));
}

export function createEmSelfService(repo: EmSelfRepository) {
  const checkins: EmCheckin[] = [...repo.loadCheckins()];
  const reflectionNotes: EmReflectionNote[] = [...repo.loadReflectionNotes()];

  function persistCheckins(): void {
    repo.saveCheckins(checkins);
  }

  function persistReflectionNotes(): void {
    repo.saveReflectionNotes(reflectionNotes);
  }

  function toCheckinView(c: EmCheckin): EmCheckin {
    return { ...c, note: unmaskNames(c.note) };
  }

  function toReflectionNoteView(n: EmReflectionNote): EmReflectionNote {
    return { ...n, text: unmaskNames(n.text) };
  }

  function listCheckins(): EmCheckin[] {
    return [...checkins].sort((a, b) => b.createdAt - a.createdAt);
  }

  async function addCheckin(input: {
    mood: number;
    energy: number;
    stress: number;
    headroom: number;
    note: string;
    createdAt?: number;
  }): Promise<EmCheckin> {
    const checkin: EmCheckin = {
      id: randomUUID(),
      mood: clampScale(input.mood),
      energy: clampScale(input.energy),
      stress: clampScale(input.stress),
      headroom: clampScale(input.headroom),
      note: input.note.trim() ? await maskForStorage(input.note.trim()) : "",
      createdAt: input.createdAt ?? Date.now(),
    };
    checkins.push(checkin);
    persistCheckins();
    return checkin;
  }

  function listReflectionNotes(): EmReflectionNote[] {
    return [...reflectionNotes].sort((a, b) => b.createdAt - a.createdAt);
  }

  async function addReflectionNote(input: {
    type: ReflectionNoteType;
    text: string;
    createdAt?: number;
  }): Promise<EmReflectionNote> {
    const note: EmReflectionNote = {
      id: randomUUID(),
      type: input.type,
      text: await maskForStorage(input.text.trim()),
      createdAt: input.createdAt ?? Date.now(),
    };
    reflectionNotes.push(note);
    persistReflectionNotes();
    return note;
  }

  function setReflectionNoteArchived(
    id: string,
    archived: boolean,
    opts?: { now?: number },
  ): EmReflectionNote | undefined {
    const note = reflectionNotes.find((n) => n.id === id);
    if (!note) return undefined;
    if (archived) {
      note.archivedAt = opts?.now ?? Date.now();
    } else {
      delete note.archivedAt;
    }
    persistReflectionNotes();
    return note;
  }

  return {
    toCheckinView,
    toReflectionNoteView,
    listCheckins,
    addCheckin,
    listReflectionNotes,
    addReflectionNote,
    setReflectionNoteArchived,
  };
}
