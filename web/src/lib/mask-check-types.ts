/**
 * 個人・機密情報チェックの共有型。
 * lexicon が mask-check 本体に循環依存しないよう型だけ分離する。
 */
export type SensitiveCategory =
  | "email"
  | "phone"
  | "url_secret"
  | "api_key_like"
  | "health"
  | "compensation"
  | "credential_mention"
  | "customer_or_contract"
  | "other_sensitive";
