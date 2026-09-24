export type EmCheckin = {
  id: string;
  mood: number;
  energy: number;
  stress: number;
  headroom?: number;
  note: string;
  createdAt: number;
};

export type ReflectionNoteType = "keep" | "problem" | "try";

export type EmReflectionNote = {
  id: string;
  type: ReflectionNoteType;
  text: string;
  createdAt: number;
  archivedAt?: number;
};
