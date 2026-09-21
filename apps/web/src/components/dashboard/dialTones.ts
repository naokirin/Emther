export type DialTone = "good" | "warn" | "bad" | "accent" | "unknown";

/** EM負荷: 低いほど良い。 */
export function loadTone(ratio: number): DialTone {
  if (ratio >= 0.75) return "bad";
  if (ratio >= 0.4) return "warn";
  return "good";
}

/** 健全度・カバレッジ: 高いほど良い。カバレッジは良いとき accent。 */
export function healthTone(ratio: number | null): DialTone {
  if (ratio === null) return "unknown";
  if (ratio >= 0.7) return "good";
  if (ratio >= 0.4) return "warn";
  return "bad";
}

export function coverageTone(ratio: number | null): DialTone {
  if (ratio === null) return "unknown";
  if (ratio >= 0.7) return "accent";
  if (ratio >= 0.4) return "warn";
  return "bad";
}
