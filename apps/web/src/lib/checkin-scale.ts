// 自己チェックインは内部で1〜5を保持し、UIは位置／定性ラベルで見せる。
// ストレスだけ「高い＝悪い」なので、グラフでは反転して「上＝良い」に揃える。

export const SCALE_OPTIONS = [1, 2, 3, 4, 5] as const;
export type ScaleValue = (typeof SCALE_OPTIONS)[number];

export type CheckinMetricKey = "mood" | "energy" | "stress" | "headroom";

const SCALE_LABELS = ["低", "やや低", "中", "やや高", "高"] as const;

export function scaleLabel(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const rounded = Math.min(5, Math.max(1, Math.round(value)));
  return SCALE_LABELS[rounded - 1];
}

export type MeterEndpoints = { left: string; right: string; caption: string };

export const METER_ENDPOINTS: Record<CheckinMetricKey, MeterEndpoints> = {
  mood: { left: "悪い", right: "良い", caption: "悪い ← → 良い" },
  energy: { left: "低い", right: "高い", caption: "低い ← → 高い" },
  stress: { left: "弱い", right: "強い", caption: "弱い ← → 強い" },
  headroom: { left: "余裕なし", right: "余裕あり", caption: "余裕がない ← → 余裕がある" },
};

export const METRIC_LABEL: Record<CheckinMetricKey, string> = {
  mood: "気分",
  energy: "エネルギー",
  stress: "ストレス",
  headroom: "心の余裕",
};

/** チャート描画用。ストレスのみ 6 - n で「上＝良い」に揃える。 */
export function toChartValue(key: CheckinMetricKey, value: number | null): number | null {
  if (value == null) return null;
  return key === "stress" ? 6 - value : value;
}
