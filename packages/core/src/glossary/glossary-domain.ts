import { randomUUID } from "node:crypto";
import type { GlossaryRepository } from "./glossary-repository";
import type { GlossaryEntry, NewGlossaryInput } from "./glossary-types";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceAllAtOnce(text: string, mapping: Map<string, string>): string {
  const keys = [...mapping.keys()].filter(Boolean).sort((a, b) => b.length - a.length);
  if (keys.length === 0) return text;
  const pattern = new RegExp(keys.map(escapeRegExp).join("|"), "g");
  return text.replace(pattern, (match) => mapping.get(match) ?? match);
}

/**
 * 用語集ドメイン。永続化は GlossaryRepository 経由のみ。
 * loadJSON / saveJSON / ファイル名は知らない。
 */
export function createGlossaryService(repo: GlossaryRepository) {
  const entries: GlossaryEntry[] = [];
  let termCounter = 0;

  function nextMaskId(): string {
    termCounter += 1;
    return `TERM_${termCounter}`;
  }

  function normalizeEntry(
    raw: Omit<GlossaryEntry, "maskId" | "maskEnabled"> & {
      maskId?: string;
      maskEnabled?: boolean;
    },
  ): { entry: GlossaryEntry; changed: boolean } {
    let changed = false;
    let maskId = raw.maskId;
    if (!maskId || !/^TERM_\d+$/.test(maskId)) {
      maskId = nextMaskId();
      changed = true;
    } else {
      const n = Number(maskId.slice(5));
      if (Number.isFinite(n) && n > termCounter) termCounter = n;
    }
    const maskEnabled = raw.maskEnabled === true;
    if (raw.maskEnabled !== maskEnabled) changed = true;
    return {
      entry: { ...raw, maskId, maskEnabled },
      changed,
    };
  }

  {
    let migrated = false;
    for (const raw of repo.load()) {
      const { entry, changed } = normalizeEntry(raw);
      if (changed) migrated = true;
      entries.push(entry);
    }
    if (migrated) repo.save(entries);
  }

  function persist(): void {
    repo.save(entries);
  }

  function listGlossaryEntries(): GlossaryEntry[] {
    return [...entries].sort((a, b) => a.term.localeCompare(b.term, "ja"));
  }

  function getGlossaryEntry(id: string): GlossaryEntry | undefined {
    return entries.find((e) => e.id === id);
  }

  function addGlossaryEntry(input: NewGlossaryInput): GlossaryEntry {
    const now = Date.now();
    const entry: GlossaryEntry = {
      id: randomUUID(),
      term: input.term.trim(),
      reading: input.reading?.trim() || undefined,
      meaning: input.meaning.trim(),
      category: input.category?.trim() || undefined,
      maskId: nextMaskId(),
      maskEnabled: input.maskEnabled === true,
      createdAt: now,
      updatedAt: now,
    };
    entries.push(entry);
    persist();
    return entry;
  }

  function updateGlossaryEntry(
    id: string,
    patch: Partial<NewGlossaryInput>,
  ): GlossaryEntry | undefined {
    const entry = getGlossaryEntry(id);
    if (!entry) return undefined;

    if (patch.term !== undefined) entry.term = patch.term.trim();
    if (patch.reading !== undefined) entry.reading = patch.reading.trim() || undefined;
    if (patch.meaning !== undefined) entry.meaning = patch.meaning.trim();
    if (patch.category !== undefined) entry.category = patch.category.trim() || undefined;
    if (patch.maskEnabled !== undefined) entry.maskEnabled = patch.maskEnabled === true;
    entry.updatedAt = Date.now();

    persist();
    return entry;
  }

  function deleteGlossaryEntry(id: string): boolean {
    const idx = entries.findIndex((e) => e.id === id);
    if (idx === -1) return false;
    entries.splice(idx, 1);
    persist();
    return true;
  }

  function formatTermToken(maskId: string): string {
    return `{{${maskId}}}`;
  }

  function buildTermMaskMapping(): Map<string, string> {
    const out = new Map<string, string>();
    for (const e of entries) {
      if (!e.maskEnabled) continue;
      const term = e.term.trim();
      if (term) out.set(term, formatTermToken(e.maskId));
    }
    return out;
  }

  function maskGlossaryTerms(text: string): string {
    return replaceAllAtOnce(text, buildTermMaskMapping());
  }

  function unmaskGlossaryTerms(text: string): string {
    const idToTerm = new Map(entries.map((e) => [e.maskId, e.term]));
    const fromTokens = text.replace(/\{\{(TERM_\d+)\}\}/g, (full, id: string) => idToTerm.get(id) ?? full);
    return fromTokens.replace(/TERM_\d+/g, (full) => idToTerm.get(full) ?? full);
  }

  function detectLeakedGlossaryTerms(text: string): string[] {
    const hits: string[] = [];
    for (const term of buildTermMaskMapping().keys()) {
      if (term && text.includes(term)) hits.push(term);
    }
    return hits;
  }

  function buildGlossaryContextBlock(): string {
    if (entries.length === 0) return "";
    const anyMasked = entries.some((e) => e.maskEnabled);
    const lines = entries.map((e) => {
      const cat = e.category ? `[${e.category}] ` : "";
      const label = e.maskEnabled ? e.maskId : e.term;
      return `- ${cat}${label}: ${e.meaning}`;
    });

    const header = anyMasked
      ? "社内用語・コンテキスト辞書（組織固有の略語・プロジェクト名・専門用語。解釈や要約時に正確に参照すること。TERM_n はマスク済みの社内用語 ID で、実表記は使わないこと）:"
      : "社内用語・コンテキスト辞書（組織固有の略語・プロジェクト名・専門用語。解釈や要約時に正確に参照すること）:";

    return [header, ...lines].join("\n");
  }

  return {
    listGlossaryEntries,
    getGlossaryEntry,
    addGlossaryEntry,
    updateGlossaryEntry,
    deleteGlossaryEntry,
    buildGlossaryContextBlock,
    maskGlossaryTerms,
    unmaskGlossaryTerms,
    detectLeakedGlossaryTerms,
  };
}

export type GlossaryService = ReturnType<typeof createGlossaryService>;
