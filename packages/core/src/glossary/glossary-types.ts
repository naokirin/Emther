export type GlossaryEntry = {
  id: string;
  term: string;
  reading?: string;
  meaning: string;
  category?: string;
  createdAt: number;
  updatedAt: number;
};

export type NewGlossaryInput = {
  term: string;
  reading?: string;
  meaning: string;
  category?: string;
};
