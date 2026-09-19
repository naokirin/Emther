import { randomUUID } from "node:crypto";
import { loadJSON, saveJSON } from "@core/persistence";

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

const entries: GlossaryEntry[] = loadJSON<GlossaryEntry[]>("glossary.json", []);

function persist(): void {
  saveJSON("glossary.json", entries);
}

export function listGlossaryEntries(): GlossaryEntry[] {
  return [...entries].sort((a, b) => a.term.localeCompare(b.term, "ja"));
}

export function getGlossaryEntry(id: string): GlossaryEntry | undefined {
  return entries.find((e) => e.id === id);
}

export function addGlossaryEntry(input: NewGlossaryInput): GlossaryEntry {
  const now = Date.now();
  const entry: GlossaryEntry = {
    id: randomUUID(),
    term: input.term.trim(),
    reading: input.reading?.trim() || undefined,
    meaning: input.meaning.trim(),
    category: input.category?.trim() || undefined,
    createdAt: now,
    updatedAt: now,
  };
  entries.push(entry);
  persist();
  return entry;
}

export function updateGlossaryEntry(
  id: string,
  patch: Partial<NewGlossaryInput>,
): GlossaryEntry | undefined {
  const entry = getGlossaryEntry(id);
  if (!entry) return undefined;

  if (patch.term !== undefined) entry.term = patch.term.trim();
  if (patch.reading !== undefined) entry.reading = patch.reading.trim() || undefined;
  if (patch.meaning !== undefined) entry.meaning = patch.meaning.trim();
  if (patch.category !== undefined) entry.category = patch.category.trim() || undefined;
  entry.updatedAt = Date.now();

  persist();
  return entry;
}

export function deleteGlossaryEntry(id: string): boolean {
  const idx = entries.findIndex((e) => e.id === id);
  if (idx === -1) return false;
  entries.splice(idx, 1);
  persist();
  return true;
}

/**
 * AIプロンプト（Agent Runtimeやローカル要約）へ注入するためのコンテキストブロックを生成する。
 */
export function buildGlossaryContextBlock(): string {
  if (entries.length === 0) return "";
  const lines = entries.map((e) => {
    const reading = e.reading ? `（読み: ${e.reading}）` : "";
    const cat = e.category ? `[${e.category}] ` : "";
    return `- ${cat}${e.term}${reading}: ${e.meaning}`;
  });

  return [
    "社内用語・コンテキスト辞書（組織固有の略語・プロジェクト名・専門用語。解釈や要約時に正確に参照すること）:",
    ...lines,
  ].join("\n");
}
