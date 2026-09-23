// Phase A: ドメイン判断は @emther/core/dashboard-next-actions。ここでは UI コールバック配線のみ。
import type { NextAction as CoreNextAction, NextActionTarget } from "@emther/core/dashboard-next-actions";

export type {
  BuildNextActionsParams,
  Lane,
  NextActionTarget,
  UrgencyMeter,
} from "@emther/core/dashboard-next-actions";

export type { NextAction as CoreNextAction } from "@emther/core/dashboard-next-actions";

export {
  LANE_META,
  buildNextActions,
  heroRank,
  isSuggestionDeferredFromDailyQueue,
  rankActions,
  selectWatchingItems,
  urgencyMeter,
} from "@emther/core/dashboard-next-actions";

/** UI 向け: target の代わりに onSelect を持つ。 */
export type NextAction = Omit<CoreNextAction, "target"> & {
  onSelect: () => void;
};

export type NextActionHandlers = {
  push: (path: string) => void;
  goToRunSuggestion: (runId: string) => void;
  prefillJournal: (text: string) => void;
  onConfirmUnmasked: (pendingId: string) => void;
};

export function resolveNextActionTarget(target: NextActionTarget, handlers: NextActionHandlers): void {
  switch (target.type) {
    case "path":
      if (target.path) handlers.push(target.path);
      return;
    case "run-suggestion":
      handlers.goToRunSuggestion(target.runId);
      return;
    case "prefill-journal":
      handlers.prefillJournal(target.text);
      return;
    case "confirm-unmasked":
      handlers.onConfirmUnmasked(target.pendingId);
      return;
  }
}

export function attachNextActionHandlers(
  actions: CoreNextAction[],
  handlers: NextActionHandlers,
): NextAction[] {
  return actions.map(({ target, ...rest }) => ({
    ...rest,
    onSelect: () => resolveNextActionTarget(target, handlers),
  }));
}
