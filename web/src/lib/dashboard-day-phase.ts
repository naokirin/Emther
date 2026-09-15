// docs/memo.md TODO「人間EMからのインプットパターン（始業時・随時・終業時など）を設計して
// ダッシュボードに組み込む」対応。docs/first_impressionが想定する朝/日中/終業時の3フェーズを、
// 新しいデータモデルは増やさず、現在時刻に応じた案内文（軽量なバナー）としてのみ表現する。
// 時刻はクライアント（EMのブラウザ）のローカル時刻を使う。
export type DayPhase = "morning" | "midday" | "evening";

export function getDayPhase(hour: number): DayPhase {
  if (hour < 11) return "morning";
  if (hour < 17) return "midday";
  return "evening";
}

export const DAY_PHASE_GUIDANCE: Record<DayPhase, { icon: string; text: string; cta?: string }> = {
  morning: {
    icon: "🌅",
    text: "朝のチェック: 今期の焦点（テーマ）に対する今日の問いを、下の「次の1手」から片づけましょう。",
  },
  midday: {
    icon: "🕐",
    text: "気になる出来事は、その場でメモしておくと後で役立ちます。構造化は後回しで構いません。",
    cta: "メモする",
  },
  evening: {
    icon: "🌆",
    text: "終業前に、今日あったことを分割を考えず書き連ねましょう（分割・提案化は翌朝の提案に寄せます）。",
    cta: "書き連ねる",
  },
};
