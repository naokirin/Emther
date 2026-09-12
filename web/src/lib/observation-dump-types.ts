// クライアント／サーバー共用の Observation Dump 型（Node API に依存しない）。
// docs/observation_dump_journal.md

export type ObservationSourceType = "chat_log" | "meeting_log" | "other_log";

export type ObservationDumpStatus =
  | "received"
  | "parsing"
  | "draft_ready"
  | "partially_accepted"
  | "done"
  | "discarded"
  | "failed";

export type ChunkDisposition = "pending" | "accept" | "edit" | "merge_into" | "drop";

export type ChunkDraftView = {
  id: string;
  text: string;
  suggestedOccurredAt?: string;
  people: string[];
  tags: string[];
  confidence: number;
  disposition: ChunkDisposition;
  dropReason?: string;
  acceptedJournalId?: string;
};

export type ObservationDumpView = {
  id: string;
  sourceType: ObservationSourceType;
  title?: string;
  rawText: string;
  status: ObservationDumpStatus;
  createdAt: number;
  updatedAt: number;
  occurredRangeHint?: { start?: string; end?: string };
  parseError?: string;
  parseSource?: "cloud" | "heuristic";
  chunkDrafts: ChunkDraftView[];
  droppedNotes: string[];
  /** 取り込み時に使った列マッピング（再分割の参考） */
  importMapping?: import("@/lib/observation-dump-mapping-types").ImportMappingConfig;
};

export const OBSERVATION_SOURCE_TYPES: ObservationSourceType[] = [
  "chat_log",
  "meeting_log",
  "other_log",
];

export function isObservationSourceType(v: unknown): v is ObservationSourceType {
  return typeof v === "string" && (OBSERVATION_SOURCE_TYPES as string[]).includes(v);
}
