// 朝/日中/終業時の案内。新しいデータモデルは増やさず、現在時刻に応じた軽量バナーのみ。
// 時刻はクライアント（EMのブラウザ）のローカル時刻を使う。
export type DayPhase = "morning" | "midday" | "evening";

export function getDayPhase(hour: number): DayPhase {
  if (hour < 11) return "morning";
  if (hour < 17) return "midday";
  return "evening";
}
