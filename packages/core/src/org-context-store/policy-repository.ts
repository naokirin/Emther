import type { PolicyEntry } from "./policy-types";

/** Policy の永続化ポート。ドメインはファイル名を知らない。 */
export type PolicyRepository = {
  load(): PolicyEntry[];
  save(policies: PolicyEntry[]): void;
};
