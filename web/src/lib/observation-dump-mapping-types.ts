// クライアント／サーバー共用: 観測取り込みの構文と列→意味マッピング

export type ImportSyntax = "jsonl" | "tsv" | "csv" | "plain";

export type SemanticField =
  | "text"
  | "sender"
  | "ts"
  | "channel"
  | "threadId"
  | "permalink"
  | "ignore";

export type TsKind = "auto" | "unix_seconds" | "unix_millis" | "iso" | "slack";

/** 列名（JSONLキー or TSVヘッダ or "0","1",…）→ 意味 */
export type FieldMapping = Record<string, SemanticField>;

export type ImportMappingConfig = {
  syntax: ImportSyntax;
  fieldMapping: FieldMapping;
  tsKind: TsKind;
  /** tsv/csv: 先頭行をヘッダとみなす（false なら列番号 0,1,…） */
  hasHeader?: boolean;
};

export type ImportProfile = {
  id: string;
  name: string;
  config: ImportMappingConfig;
  createdAt: number;
  updatedAt: number;
};

export type ImportPreview = {
  suggestedSyntax: ImportSyntax;
  columns: string[];
  suggestedMapping: FieldMapping;
  suggestedTsKind: TsKind;
  hasHeader: boolean;
  sampleRows: Record<string, string>[];
  rowCount: number;
  canAutoNormalize: boolean;
};

export const SEMANTIC_FIELD_OPTIONS: { value: SemanticField; label: string }[] = [
  { value: "ignore", label: "（使わない）" },
  { value: "text", label: "本文 text" },
  { value: "sender", label: "送信者 sender" },
  { value: "ts", label: "日時 ts" },
  { value: "channel", label: "チャンネル channel" },
  { value: "threadId", label: "スレッドID threadId" },
  { value: "permalink", label: "リンク permalink" },
];

export const IMPORT_SYNTAX_OPTIONS: { value: ImportSyntax; label: string }[] = [
  { value: "jsonl", label: "JSONL（1行1オブジェクト）" },
  { value: "tsv", label: "TSV（タブ区切り）" },
  { value: "csv", label: "CSV（カンマ区切り）" },
  { value: "plain", label: "平文（正規化なし）" },
];

export const TS_KIND_OPTIONS: { value: TsKind; label: string }[] = [
  { value: "auto", label: "自動（秒/ミリ秒/ISO）" },
  { value: "slack", label: "Slack ts（秒.小数）" },
  { value: "unix_seconds", label: "Unix 秒" },
  { value: "unix_millis", label: "Unix ミリ秒" },
  { value: "iso", label: "ISO 8601 / 日付文字列" },
];

export const BUILTIN_SLACK_JSONL_MAPPING: FieldMapping = {
  ts: "ts",
  channel: "channel",
  sender: "sender",
  text: "text",
  permalink: "permalink",
};

export function isImportSyntax(v: unknown): v is ImportSyntax {
  return v === "jsonl" || v === "tsv" || v === "csv" || v === "plain";
}

export function isTsKind(v: unknown): v is TsKind {
  return (
    v === "auto" ||
    v === "unix_seconds" ||
    v === "unix_millis" ||
    v === "iso" ||
    v === "slack"
  );
}

export function isSemanticField(v: unknown): v is SemanticField {
  return (
    v === "text" ||
    v === "sender" ||
    v === "ts" ||
    v === "channel" ||
    v === "threadId" ||
    v === "permalink" ||
    v === "ignore"
  );
}

export function parseFieldMapping(raw: unknown): FieldMapping | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const out: FieldMapping = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof k === "string" && isSemanticField(v)) out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function parseImportMappingConfig(raw: unknown): ImportMappingConfig | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  if (!isImportSyntax(o.syntax)) return undefined;
  const fieldMapping = parseFieldMapping(o.fieldMapping);
  if (!fieldMapping && o.syntax !== "plain") return undefined;
  const tsKind = isTsKind(o.tsKind) ? o.tsKind : "auto";
  return {
    syntax: o.syntax,
    fieldMapping: fieldMapping ?? {},
    tsKind,
    hasHeader: typeof o.hasHeader === "boolean" ? o.hasHeader : undefined,
  };
}
