import type { JournalBatchPersisted } from "../../agent-runtime/journal-batch-types";
import { createJsonSingletonDocument } from "../json-document";

type RawJournalBatchFile = {
  date?: string | null;
  claimedHours?: unknown;
  lastCoveredAt?: unknown;
  activeSinceExclusive?: unknown;
  activeUntil?: unknown;
};

export type JournalBatchRepository = {
  loadRaw(): RawJournalBatchFile;
  save(state: JournalBatchPersisted): void;
};

const doc = createJsonSingletonDocument<RawJournalBatchFile>("auto-journal-batch.json", {});

export function createJsonJournalBatchRepository(): JournalBatchRepository {
  return {
    loadRaw: () => doc.load(),
    save: (state) =>
      doc.save({
        date: state.date,
        claimedHours: state.claimedHours,
        lastCoveredAt: state.lastCoveredAt,
        activeSinceExclusive: state.activeSinceExclusive,
        activeUntil: state.activeUntil,
      }),
  };
}
