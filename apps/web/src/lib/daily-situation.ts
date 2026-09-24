// ドメイン判断は @emther/core/daily-situation。ここでは UI コールバック配線のみ。
import type {
  DailySituation as CoreDailySituation,
  SituationItem as CoreSituationItem,
} from "@emther/core/daily-situation";
import { resolveNextActionTarget, type NextActionHandlers } from "./dashboard-next-actions";

export type {
  BuildDailySituationParams,
  ConcernSignalKind,
  SituationItemTarget,
} from "@emther/core/daily-situation";

export { CONCERN_SIGNAL_LABEL, buildDailySituation } from "@emther/core/daily-situation";

/** UI 向け: target の代わりに onSelect を持つ。 */
export type SituationItem = Omit<CoreSituationItem, "target"> & {
  onSelect?: () => void;
};

export type DailySituation = {
  changes: SituationItem[];
  concerns: SituationItem[];
  good: SituationItem[];
  unevaluable: SituationItem[];
  comparisons: SituationItem[];
  worthDeciding: SituationItem[];
  worthDecidingOverflow: number;
};

function attachItem(item: CoreSituationItem, handlers: NextActionHandlers): SituationItem {
  const { target, ...rest } = item;
  if (!target) return rest;
  return {
    ...rest,
    onSelect: () => resolveNextActionTarget(target, handlers),
  };
}

export function attachDailySituationHandlers(
  situation: CoreDailySituation,
  handlers: NextActionHandlers,
): DailySituation {
  return {
    changes: situation.changes.map((i) => attachItem(i, handlers)),
    concerns: situation.concerns.map((i) => attachItem(i, handlers)),
    good: situation.good.map((i) => attachItem(i, handlers)),
    unevaluable: situation.unevaluable.map((i) => attachItem(i, handlers)),
    comparisons: situation.comparisons.map((i) => attachItem(i, handlers)),
    worthDeciding: situation.worthDeciding.map((i) => attachItem(i, handlers)),
    worthDecidingOverflow: situation.worthDecidingOverflow,
  };
}
