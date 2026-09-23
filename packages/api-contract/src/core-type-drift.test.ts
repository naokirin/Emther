import { describe, expect, it } from "vitest";
import type { AgentRun } from "@emther/core/agent-runtime";
import type {
  EmCheckin as CoreEmCheckin,
  EmReflectionNote as CoreEmReflectionNote,
  Goal as CoreGoal,
  GrowSuggestion as CoreGrowSuggestion,
  OrgBackgroundEntry as CoreOrgBackgroundEntry,
  OrgStrategy as CoreOrgStrategy,
  OrgTheme as CoreOrgTheme,
  PolicyEntry as CorePolicyEntry,
  Report as CoreReport,
  Team as CoreTeam,
} from "@emther/core/types";
import type { AgentRunView } from "./entities/agents";
import type { EmCheckin as ContractEmCheckin, EmReflectionNote as ContractEmReflectionNote } from "./entities/em-self";
import type { GrowSuggestion as ContractGrowSuggestion } from "./entities/growth";
import type {
  Goal as ContractGoal,
  OrgBackgroundEntry as ContractOrgBackgroundEntry,
  OrgStrategy as ContractOrgStrategy,
  PolicyEntry as ContractPolicyEntry,
} from "./entities/org";
import type { Report as ContractReport } from "./entities/report";
import type { Team as ContractTeam } from "./entities/team";
import type { OrgTheme as ContractOrgTheme } from "./entities/theme";

// Compile-time: contract type must be assignable both ways with core (core is source of truth).
type Equal<A, B> = (<U>() => U extends A ? 1 : 2) extends <U>() => U extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

type CoreContractDriftChecks = [
  Expect<Equal<CoreTeam, ContractTeam>>,
  Expect<Equal<CoreEmCheckin, ContractEmCheckin>>,
  Expect<Equal<CoreEmReflectionNote, ContractEmReflectionNote>>,
  Expect<Equal<CoreGoal, ContractGoal>>,
  Expect<Equal<CorePolicyEntry, ContractPolicyEntry>>,
  Expect<Equal<CoreOrgStrategy, ContractOrgStrategy>>,
  Expect<Equal<CoreOrgBackgroundEntry, ContractOrgBackgroundEntry>>,
  Expect<Equal<CoreOrgTheme, ContractOrgTheme>>,
  Expect<Equal<CoreReport, ContractReport>>,
  Expect<Equal<CoreGrowSuggestion, ContractGrowSuggestion>>,
  Expect<Equal<AgentRun, AgentRunView>>,
];

describe("@emther/api-contract core-type-drift（コンパイル時 Equal）", () => {
  it("型チェック用ファイルがロードできる", () => {
    // 型エイリアスを値文脈で参照し、未使用判定を避ける
    const _checks: CoreContractDriftChecks | undefined = undefined;
    expect(_checks).toBeUndefined();
  });
});
