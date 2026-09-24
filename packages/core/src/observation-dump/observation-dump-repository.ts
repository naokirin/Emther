import type { ObservationDump } from "./observation-dump-entity";

export type ObservationDumpRepository = {
  load(): ObservationDump[];
  save(dumps: ObservationDump[]): void;
};
