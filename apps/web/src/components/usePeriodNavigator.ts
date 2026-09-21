import { useState } from "react";
import { periodWindow, type PeriodUnit } from "@emther/core/daily-trends";

// ---------- 期間ナビゲーション（週／月をカレンダー単位で前後に移動） ----------

export function usePeriodNavigator(defaultUnit: PeriodUnit = "week") {
  const [unit, setUnitRaw] = useState<PeriodUnit>(defaultUnit);
  const [offset, setOffset] = useState(0);
  const window = periodWindow(unit, offset);

  function setUnit(next: PeriodUnit) {
    setUnitRaw(next);
    setOffset(0);
  }

  return { unit, setUnit, offset, setOffset, window, label: window.label, isLatest: offset === 0 };
}

export type PeriodNavigatorState = ReturnType<typeof usePeriodNavigator>;
