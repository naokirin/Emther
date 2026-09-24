import { createObservationDumpService } from "./observation-dump-domain";
import { createJsonObservationDumpRepository } from "../persistence/adapters/json-observation-dump-repository";

export type { ChunkDraft, ObservationDump } from "./observation-dump-entity";
export type {
  ChunkDisposition,
  ObservationDumpStatus,
  ObservationDumpView,
  ObservationSourceType,
} from "./observation-dump-types";
export { isObservationSourceType, OBSERVATION_SOURCE_TYPES } from "./observation-dump-types";

const service = createObservationDumpService(createJsonObservationDumpRepository());

export const listObservationDumps = service.listObservationDumps;
export const getObservationDump = service.getObservationDump;
export const toObservationDumpView = service.toObservationDumpView;
export const createObservationDump = service.createObservationDump;
export const updateObservationDump = service.updateObservationDump;
export const discardObservationDump = service.discardObservationDump;
export const deleteObservationDump = service.deleteObservationDump;
export const patchChunkDrafts = service.patchChunkDrafts;
export const refreshDumpStatusAfterAccept = service.refreshDumpStatusAfterAccept;
