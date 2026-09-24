import type { ImportMappingConfig } from "./observation-dump-mapping-types";
import type {
  ChunkDisposition,
  ObservationDumpStatus,
  ObservationSourceType,
} from "./observation-dump-types";

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
  importMapping?: ImportMappingConfig;
};
