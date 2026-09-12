import { randomUUID } from "node:crypto";
import { loadJSON, saveJSON } from "@/lib/persistence";
import { ensureNameCandidatesAllowed, maskForStorage, unmaskNames } from "@/lib/people-directory";
import type { MaskOptions } from "@/lib/name-candidate-confirmation";
import {
  isObservationSourceType,
  type ChunkDisposition,
  type ObservationDumpStatus,
  type ObservationDumpView,
  type ObservationSourceType,
} from "@/lib/observation-dump-types";

export type {
  ChunkDisposition,
  ObservationDumpStatus,
  ObservationDumpView,
  ObservationSourceType,
} from "@/lib/observation-dump-types";
export { isObservationSourceType, OBSERVATION_SOURCE_TYPES } from "@/lib/observation-dump-types";

// docs/observation_dump_journal.md: Slack/MTG 等の未分割観測を薄い Dump として残し、
// AI チャンク提案→採用分だけ Journal 化する。永続本文は常にマスク済み。

export type ChunkDraft = {
  id: string;
  textMasked: string;
  suggestedOccurredAt?: string;
  people: string[];
  tags: string[];
  confidence: number;
  disposition: ChunkDisposition;
  dropReason?: string;
  acceptedJournalId?: string;
};

export type ObservationDump = {
  id: string;
  sourceType: ObservationSourceType;
  title?: string;
  rawTextMasked: string;
  status: ObservationDumpStatus;
  createdAt: number;
  updatedAt: number;
  occurredRangeHint?: { start?: string; end?: string };
  parseError?: string;
  parseSource?: "cloud" | "heuristic";
  chunkDrafts: ChunkDraft[];
  droppedNotes: string[];
};

const dumps: ObservationDump[] = loadJSON<ObservationDump[]>("observation-dumps.json", []);

function persist(): void {
  saveJSON("observation-dumps.json", dumps);
}

export function listObservationDumps(): ObservationDump[] {
  return [...dumps].sort((a, b) => b.createdAt - a.createdAt);
}

export function getObservationDump(id: string): ObservationDump | undefined {
  return dumps.find((d) => d.id === id);
}

export function toObservationDumpView(dump: ObservationDump): ObservationDumpView {
  return {
    id: dump.id,
    sourceType: dump.sourceType,
    title: dump.title !== undefined ? unmaskNames(dump.title) : undefined,
    rawText: unmaskNames(dump.rawTextMasked),
    status: dump.status,
    createdAt: dump.createdAt,
    updatedAt: dump.updatedAt,
    occurredRangeHint: dump.occurredRangeHint,
    parseError: dump.parseError,
    parseSource: dump.parseSource,
    droppedNotes: dump.droppedNotes.map(unmaskNames),
    chunkDrafts: dump.chunkDrafts.map((c) => ({
      id: c.id,
      text: unmaskNames(c.textMasked),
      suggestedOccurredAt: c.suggestedOccurredAt,
      people: c.people.map(unmaskNames),
      tags: c.tags.map(unmaskNames),
      confidence: c.confidence,
      disposition: c.disposition,
      dropReason: c.dropReason !== undefined ? unmaskNames(c.dropReason) : undefined,
      acceptedJournalId: c.acceptedJournalId,
    })),
  };
}

export async function createObservationDump(
  input: {
    sourceType: ObservationSourceType;
    text: string;
    title?: string;
    occurredRangeHint?: { start?: string; end?: string };
  },
  opts: MaskOptions = {},
): Promise<ObservationDump> {
  const text = input.text.trim();
  if (!text) throw new Error("textは必須です");
  if (!isObservationSourceType(input.sourceType)) throw new Error("sourceTypeが不正です");

  const texts = [text];
  if (input.title?.trim()) texts.push(input.title.trim());
  await ensureNameCandidatesAllowed(texts, opts);
  const now = Date.now();
  const rawTextMasked = await maskForStorage(text, opts);
  const title = input.title?.trim()
    ? await maskForStorage(input.title.trim(), opts)
    : undefined;

  const dump: ObservationDump = {
    id: randomUUID(),
    sourceType: input.sourceType,
    title,
    rawTextMasked,
    status: "received",
    createdAt: now,
    updatedAt: now,
    occurredRangeHint: input.occurredRangeHint,
    chunkDrafts: [],
    droppedNotes: [],
  };
  dumps.unshift(dump);
  persist();
  return dump;
}

export function updateObservationDump(
  id: string,
  patch: Partial<
    Pick<
      ObservationDump,
      "status" | "parseError" | "parseSource" | "chunkDrafts" | "droppedNotes" | "title" | "occurredRangeHint"
    >
  >,
): ObservationDump | undefined {
  const idx = dumps.findIndex((d) => d.id === id);
  if (idx < 0) return undefined;
  const current = dumps[idx];
  const next: ObservationDump = {
    ...current,
    ...patch,
    updatedAt: Date.now(),
  };
  dumps[idx] = next;
  persist();
  return next;
}

export function discardObservationDump(id: string): ObservationDump | undefined {
  return updateObservationDump(id, { status: "discarded" });
}

export function deleteObservationDump(id: string): boolean {
  const idx = dumps.findIndex((d) => d.id === id);
  if (idx < 0) return false;
  dumps.splice(idx, 1);
  persist();
  return true;
}

export function patchChunkDrafts(
  dumpId: string,
  patches: Array<{
    id: string;
    disposition?: ChunkDisposition;
    text?: string;
    suggestedOccurredAt?: string | null;
    dropReason?: string | null;
  }>,
): ObservationDump | undefined {
  const dump = getObservationDump(dumpId);
  if (!dump) return undefined;
  const byId = new Map(patches.map((p) => [p.id, p]));
  const chunkDrafts = dump.chunkDrafts.map((c) => {
    const p = byId.get(c.id);
    if (!p) return c;
    return {
      ...c,
      ...(p.disposition !== undefined ? { disposition: p.disposition } : {}),
      ...(p.text !== undefined ? { textMasked: p.text } : {}),
      ...(p.suggestedOccurredAt !== undefined
        ? { suggestedOccurredAt: p.suggestedOccurredAt ?? undefined }
        : {}),
      ...(p.dropReason !== undefined ? { dropReason: p.dropReason ?? undefined } : {}),
    };
  });
  return updateObservationDump(dumpId, { chunkDrafts });
}

export function refreshDumpStatusAfterAccept(dump: ObservationDump): ObservationDumpStatus {
  const open = dump.chunkDrafts.filter(
    (c) => c.disposition === "pending" || c.disposition === "edit" || c.disposition === "merge_into",
  );
  const accepted = dump.chunkDrafts.some((c) => c.acceptedJournalId);
  if (open.length === 0) return "done";
  if (accepted) return "partially_accepted";
  return dump.status === "failed" ? "failed" : "draft_ready";
}
