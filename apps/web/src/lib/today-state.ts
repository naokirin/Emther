// Phase A: ドメイン判断は @emther/core/today-state。ここでは UI コールバック配線のみ。
import type { TodayStateMeters as CoreTodayStateMeters } from "@emther/core/today-state";
import { resolveNextActionTarget, type NextActionHandlers } from "./dashboard-next-actions";
import type { SituationItem } from "./daily-situation";

export type {
  BuildTodayStateMetersParams,
  EntityHealthBreakdown,
  StatusBreakdownBucket,
} from "@emther/core/today-state";

export { buildTodayStateMeters, elapsedDays, formatElapsedLabel } from "@emther/core/today-state";

/** UI 向け: attentionChips に onSelect を持つ。 */
export type TodayStateMeters = Omit<CoreTodayStateMeters, "attentionChips"> & {
  attentionChips: SituationItem[];
};

export function attachTodayStateHandlers(
  meters: CoreTodayStateMeters,
  handlers: NextActionHandlers,
): TodayStateMeters {
  return {
    ...meters,
    attentionChips: meters.attentionChips.map(({ target, ...rest }) => {
      if (!target) return rest;
      return {
        ...rest,
        onSelect: () => resolveNextActionTarget(target, handlers),
      };
    }),
  };
}
