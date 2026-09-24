import type { OrgStrategy } from "./strategy-types";

export type OrgStrategyRepository = {
  load(): Partial<OrgStrategy>;
  save(strategy: OrgStrategy): void;
};
