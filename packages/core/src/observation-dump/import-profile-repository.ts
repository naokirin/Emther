import type { ImportProfile } from "./observation-dump-mapping-types";

export type ImportProfileRepository = {
  load(): ImportProfile[];
  save(profiles: ImportProfile[]): void;
};
