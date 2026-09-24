import { randomUUID } from "node:crypto";
import { ensureNameCandidatesAllowed, maskForStorage, unmaskNames } from "../people-directory";
import type { MaskOptions } from "../name-candidate-confirmation";
import { guessImportSyntax, normalizeObservationInput } from "./observation-dump-normalize";
import type { ImportMappingConfig } from "./observation-dump-mapping-types";
import type { ObservationDump } from "./observation-dump-entity";
import type { ObservationDumpRepository } from "./observation-dump-repository";
import {
  isObservationSourceType,
  type ChunkDisposition,
  type ObservationDumpStatus,
  type ObservationDumpView,
  type ObservationSourceType,
} from "./observation-dump-types";

export type { ChunkDraft, ObservationDump } from "./observation-dump-entity";

// AI チャンク提案→採用分だけ Journal 化する。永続本文は常にマスク済み。

export function createObservationDumpService(repo: ObservationDumpRepository) {
  const dumps: ObservationDump[] = [...repo.load()];

  function persist(): void {
    repo.save(dumps);
  }

  function listObservationDumps(): ObservationDump[] {
    return [...dumps].sort((a, b) => b.createdAt - a.createdAt);
  }

  function getObservationDump(id: string): ObservationDump | undefined {
    return dumps.find((d) => d.id === id);
  }

  function toObservationDumpView(dump: ObservationDump): ObservationDumpView {
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
      importMapping: dump.importMapping,
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

  async function createObservationDump(
    input: {
      sourceType: ObservationSourceType;
      text: string;
      title?: string;
      occurredRangeHint?: { start?: string; end?: string };
      mapping?: ImportMappingConfig;
    },
    opts: MaskOptions = {},
  ): Promise<ObservationDump> {
    const raw = input.text.trim();
    if (!raw) throw new Error("textは必須です");
    if (!isObservationSourceType(input.sourceType)) throw new Error("sourceTypeが不正です");

    if (input.mapping && input.mapping.syntax !== "plain") {
      if (!Object.values(input.mapping.fieldMapping).includes("text")) {
        throw new Error("列対応で本文(text)を指定してください");
      }
    } else if (!input.mapping || input.mapping.syntax !== "plain") {
      const guessed = guessImportSyntax(raw);
      if (guessed !== "plain") {
        throw new Error(
          "構造化ログ（JSONL/TSV/CSV）は「列を確認する」で列対応を指定してから取り込んでください",
        );
      }
    }

    const normalized = normalizeObservationInput(raw, input.mapping);
    const text = normalized.detected ? normalized.text : raw;
    const occurredRangeHint = input.occurredRangeHint ?? normalized.occurredRangeHint;
    const importMapping = input.mapping;

    const texts = [text];
    if (input.title?.trim()) texts.push(input.title.trim());
    await ensureNameCandidatesAllowed(texts, opts);
    const now = Date.now();
    const rawTextMasked = await maskForStorage(text, opts);
    const title = input.title?.trim() ? await maskForStorage(input.title.trim(), opts) : undefined;

    const dump: ObservationDump = {
      id: randomUUID(),
      sourceType: input.sourceType,
      title,
      rawTextMasked,
      status: "received",
      createdAt: now,
      updatedAt: now,
      occurredRangeHint,
      chunkDrafts: [],
      droppedNotes: [
        ...(normalized.detected ? normalized.notes : []),
        ...(!normalized.detected && input.mapping?.syntax && input.mapping.syntax !== "plain"
          ? ["列マッピングで有効な本文行を抽出できませんでした（原文のまま保存）"]
          : []),
      ],
      importMapping,
    };
    dumps.unshift(dump);
    persist();
    return dump;
  }

  function updateObservationDump(
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

  function discardObservationDump(id: string): ObservationDump | undefined {
    return updateObservationDump(id, { status: "discarded" });
  }

  function deleteObservationDump(id: string): boolean {
    const idx = dumps.findIndex((d) => d.id === id);
    if (idx < 0) return false;
    dumps.splice(idx, 1);
    persist();
    return true;
  }

  function patchChunkDrafts(
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

  function refreshDumpStatusAfterAccept(dump: ObservationDump): ObservationDumpStatus {
    const open = dump.chunkDrafts.filter(
      (c) => c.disposition === "pending" || c.disposition === "edit" || c.disposition === "merge_into",
    );
    const accepted = dump.chunkDrafts.some((c) => c.acceptedJournalId);
    if (open.length === 0) return "done";
    if (accepted) return "partially_accepted";
    return dump.status === "failed" ? "failed" : "draft_ready";
  }

  return {
    listObservationDumps,
    getObservationDump,
    toObservationDumpView,
    createObservationDump,
    updateObservationDump,
    discardObservationDump,
    deleteObservationDump,
    patchChunkDrafts,
    refreshDumpStatusAfterAccept,
  };
}
