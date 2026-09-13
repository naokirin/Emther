// 「田中さん」「田中くん」「田中」を同一人物として扱うための敬称正規化。
// 表示用の正式名は登録時の表記を保持し、照合・マスク時だけ敬称を吸収する。
// 純粋な文字列処理のみで状態を持たないため、people-directory.tsとname-candidate-detect.ts
// の両方から参照される下位の共有モジュールとして独立させている
// （両者を直接依存させると循環参照になるため）。
export const PERSON_HONORIFICS = ["さん", "くん", "ちゃん", "様", "氏", "君"] as const;
const HONORIFIC_SUFFIX_RE = /(?:さん|くん|ちゃん|様|氏|君)$/;

export function stripPersonHonorific(name: string): string {
  return name.trim().replace(HONORIFIC_SUFFIX_RE, "").trim();
}
