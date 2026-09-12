import {
  type FieldMapping,
  type ImportMappingConfig,
  type ImportPreview,
  type ImportSyntax,
  type SemanticField,
  type TsKind,
} from "@/lib/observation-dump-mapping-types";

// 構文パース → 列マッピング → チャット平文。Slack 固定キー以外も UI マッピングで扱える。

export type CanonicalMessage = {
  ts: string;
  channel: string;
  sender: string;
  text: string;
  permalink?: string;
  threadTs?: string;
};

export type NormalizeObservationResult = {
  detected: boolean;
  text: string;
  messageCount: number;
  occurredRangeHint?: { start: string; end: string };
  notes: string[];
  appliedConfig?: ImportMappingConfig;
};

/** @deprecated 互換エイリアス */
export type NormalizeSlackJsonlResult = NormalizeObservationResult;
/** @deprecated 互換エイリアス */
export type SlackJsonlMessage = CanonicalMessage;

const CHANNEL_THREAD_PREFIX = /^スレッドの場所\s*:\s*/;

export function parseTimestampValue(
  ts: string | number | undefined,
  kind: TsKind = "auto",
): Date | undefined {
  if (ts === undefined || ts === null) return undefined;
  const raw = String(ts).trim();
  if (!raw) return undefined;

  if (kind === "iso" || (kind === "auto" && /[T/\-]/.test(raw) && Number.isNaN(Number(raw)))) {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? undefined : d;
  }

  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    if (kind === "auto") {
      const d = new Date(raw);
      return Number.isNaN(d.getTime()) ? undefined : d;
    }
    return undefined;
  }

  let ms: number;
  if (kind === "unix_millis") ms = n;
  else if (kind === "unix_seconds" || kind === "slack") ms = n * 1000;
  else ms = n >= 1e12 ? n : n * 1000; // auto

  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** @deprecated 互換 */
export function parseSlackTs(ts: string | number | undefined): Date | undefined {
  return parseTimestampValue(ts, "auto");
}

export function formatDateYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatDateTimeLocal(d: Date): string {
  const ymd = formatDateYmd(d);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${ymd} ${hh}:${mm}`;
}

export function normalizeChannelLabel(channel: string): string {
  return channel.replace(CHANNEL_THREAD_PREFIX, "").trim();
}

export function extractThreadTsFromPermalink(permalink: string | undefined): string | undefined {
  if (!permalink) return undefined;
  const m = permalink.match(/[?&]thread_ts=([0-9.]+)/);
  return m?.[1];
}

/** 簡易 CSV/TSV 分割（ダブルクォート対応） */
export function splitDelimitedLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === delimiter) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

export function guessImportSyntax(text: string): ImportSyntax {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return "plain";

  let jsonOk = 0;
  for (const line of lines.slice(0, 20)) {
    if (line.startsWith("{") || line.startsWith("[")) {
      try {
        JSON.parse(line);
        jsonOk++;
      } catch {
        /* skip */
      }
    }
  }
  if (jsonOk >= Math.max(1, Math.ceil(Math.min(lines.length, 20) * 0.5))) return "jsonl";

  const sample = lines.slice(0, 5);
  const tabCounts = sample.map((l) => (l.match(/\t/g) ?? []).length);
  const commaCounts = sample.map((l) => splitDelimitedLine(l, ",").length - 1);
  const avgTab = tabCounts.reduce((a, b) => a + b, 0) / tabCounts.length;
  const avgComma = commaCounts.reduce((a, b) => a + b, 0) / commaCounts.length;
  if (avgTab >= 1) return "tsv";
  if (avgComma >= 1) return "csv";
  return "plain";
}

const KEY_HINTS: Array<{ field: SemanticField; patterns: RegExp[] }> = [
  { field: "text", patterns: [/^text$/i, /^message$/i, /^body$/i, /^content$/i, /^msg$/i, /^本文$/] },
  { field: "sender", patterns: [/^sender$/i, /^user$/i, /^from$/i, /^author$/i, /^name$/i, /^username$/i, /^送信者$/] },
  {
    field: "ts",
    patterns: [/^ts$/i, /^timestamp$/i, /^time$/i, /^datetime$/i, /^created/i, /^date$/i, /^日時$/, /^時刻$/],
  },
  { field: "channel", patterns: [/^channel$/i, /^channel_id$/i, /^room$/i, /^チャンネル$/] },
  {
    field: "threadId",
    patterns: [/^thread$/i, /^thread_ts$/i, /^thread_id$/i, /^threadId$/i, /^parent_ts$/i],
  },
  { field: "permalink", patterns: [/^permalink$/i, /^url$/i, /^link$/i, /^href$/i] },
];

export function suggestFieldMapping(columns: string[]): FieldMapping {
  const mapping: FieldMapping = {};
  const used = new Set<SemanticField>();
  for (const col of columns) {
    let matched: SemanticField = "ignore";
    for (const hint of KEY_HINTS) {
      if (used.has(hint.field)) continue;
      if (hint.patterns.some((re) => re.test(col))) {
        matched = hint.field;
        used.add(hint.field);
        break;
      }
    }
    mapping[col] = matched;
  }
  // text が無ければ最初の非 ignore っぽい長い列名以外で最初の列を text 候補に
  if (![...Object.values(mapping)].includes("text") && columns.length > 0) {
    const fallback = columns.find((c) => mapping[c] === "ignore") ?? columns[columns.length - 1];
    mapping[fallback] = "text";
  }
  return mapping;
}

export function suggestTsKind(columns: string[], sampleValues: string[]): TsKind {
  const tsCol = columns.find((c) => /^(ts|timestamp|time)$/i.test(c));
  const samples = sampleValues.filter(Boolean).slice(0, 5);
  if (samples.some((s) => /^\d+\.\d+$/.test(s))) return "slack";
  if (samples.some((s) => /^\d{13,}$/.test(s))) return "unix_millis";
  if (samples.some((s) => /^\d{10}$/.test(s))) return "unix_seconds";
  if (samples.some((s) => /[T/\-]/.test(s) && Number.isNaN(Number(s)))) return "iso";
  if (tsCol === "ts") return "slack";
  return "auto";
}

function cellString(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return "";
  }
}

function getByPath(rec: Record<string, unknown>, key: string): unknown {
  if (key in rec) return rec[key];
  // ドットパス（thread.ts 等）は初期はトップレベルのみ。permalink から thread は別処理。
  return undefined;
}

export type PreviewRow = Record<string, string>;

export type { ImportPreview };

function parseJsonlRecords(text: string): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed[0] !== "{") continue;
    try {
      const obj = JSON.parse(trimmed);
      if (obj && typeof obj === "object" && !Array.isArray(obj)) {
        rows.push(obj as Record<string, unknown>);
      }
    } catch {
      /* skip */
    }
  }
  return rows;
}

function parseDelimited(
  text: string,
  delimiter: string,
  hasHeaderExplicit?: boolean,
): { columns: string[]; rows: Record<string, unknown>[]; hasHeader: boolean } {
  const lines = text
    .split("\n")
    .map((l) => l.replace(/\r$/, ""))
    .filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { columns: [], rows: [], hasHeader: false };

  const firstCells = splitDelimitedLine(lines[0], delimiter);
  const looksLikeHeader = firstCells.some((c) =>
    KEY_HINTS.some((h) => h.patterns.some((re) => re.test(c))),
  );
  const hasHeader = hasHeaderExplicit ?? looksLikeHeader;
  const columns = hasHeader
    ? firstCells.map((c, i) => (c.trim() ? c.trim() : `col_${i}`))
    : firstCells.map((_, i) => String(i));
  const dataLines = hasHeader ? lines.slice(1) : lines;
  const rows: Record<string, unknown>[] = [];
  for (const line of dataLines) {
    const cells = splitDelimitedLine(line, delimiter);
    const rec: Record<string, unknown> = {};
    columns.forEach((col, i) => {
      rec[col] = cells[i] ?? "";
    });
    rows.push(rec);
  }
  return { columns, rows, hasHeader };
}

export function buildImportPreview(
  text: string,
  syntaxOverride?: ImportSyntax,
  hasHeaderOverride?: boolean,
): ImportPreview {
  const trimmed = text.trim();
  const suggestedSyntax = syntaxOverride ?? guessImportSyntax(trimmed);

  if (suggestedSyntax === "plain" || !trimmed) {
    return {
      suggestedSyntax: "plain",
      columns: [],
      suggestedMapping: {},
      suggestedTsKind: "auto",
      hasHeader: false,
      sampleRows: [],
      rowCount: 0,
    };
  }

  if (suggestedSyntax === "jsonl") {
    const records = parseJsonlRecords(trimmed);
    const keySet = new Set<string>();
    for (const r of records.slice(0, 50)) {
      Object.keys(r).forEach((k) => keySet.add(k));
    }
    const columns = [...keySet];
    const suggestedMapping = suggestFieldMapping(columns);
    const tsCol = Object.entries(suggestedMapping).find(([, f]) => f === "ts")?.[0];
    const samples = tsCol
      ? records.slice(0, 8).map((r) => cellString(r[tsCol]))
      : [];
    const sampleRows = records.slice(0, 3).map((r) => {
      const row: PreviewRow = {};
      for (const c of columns) row[c] = cellString(r[c]).slice(0, 120);
      return row;
    });

    return {
      suggestedSyntax: "jsonl",
      columns,
      suggestedMapping,
      suggestedTsKind: suggestTsKind(columns, samples),
      hasHeader: false,
      sampleRows,
      rowCount: records.length,
    };
  }

  const delimiter = suggestedSyntax === "tsv" ? "\t" : ",";
  const { columns, rows, hasHeader } = parseDelimited(trimmed, delimiter, hasHeaderOverride);
  const suggestedMapping = suggestFieldMapping(columns);
  const tsCol = Object.entries(suggestedMapping).find(([, f]) => f === "ts")?.[0];
  const samples = tsCol ? rows.slice(0, 8).map((r) => cellString(r[tsCol])) : [];
  const sampleRows = rows.slice(0, 3).map((r) => {
    const row: PreviewRow = {};
    for (const c of columns) row[c] = cellString(r[c]).slice(0, 120);
    return row;
  });

  return {
    suggestedSyntax,
    columns,
    suggestedMapping,
    suggestedTsKind: suggestTsKind(columns, samples),
    hasHeader,
    sampleRows,
    rowCount: rows.length,
  };
}

function recordsFromConfig(
  text: string,
  config: ImportMappingConfig,
): Record<string, unknown>[] {
  if (config.syntax === "jsonl") return parseJsonlRecords(text);
  if (config.syntax === "tsv") {
    return parseDelimited(text, "\t", config.hasHeader).rows;
  }
  if (config.syntax === "csv") {
    return parseDelimited(text, ",", config.hasHeader).rows;
  }
  return [];
}

function applyMapping(
  rec: Record<string, unknown>,
  mapping: FieldMapping,
  tsKind: TsKind,
): CanonicalMessage | null {
  const inverted = new Map<SemanticField, string>();
  for (const [col, field] of Object.entries(mapping)) {
    if (field !== "ignore") inverted.set(field, col);
  }
  const textKey = inverted.get("text");
  if (!textKey) return null;
  const text = cellString(getByPath(rec, textKey));
  if (!text) return null;

  const senderKey = inverted.get("sender");
  const tsKey = inverted.get("ts");
  const channelKey = inverted.get("channel");
  const threadKey = inverted.get("threadId");
  const permalinkKey = inverted.get("permalink");

  const permalink = permalinkKey ? cellString(getByPath(rec, permalinkKey)) : undefined;
  let threadTs = threadKey ? cellString(getByPath(rec, threadKey)) : undefined;
  if (!threadTs && permalink) threadTs = extractThreadTsFromPermalink(permalink);

  // thread オブジェクトが残っている場合（マッピング外）
  const threadObj = rec.thread;
  if (!threadTs && threadObj && typeof threadObj === "object") {
    const t = threadObj as Record<string, unknown>;
    if (typeof t.ts === "string") threadTs = t.ts;
  }

  const channelRaw = channelKey ? cellString(getByPath(rec, channelKey)) : "";
  const tsRaw = tsKey ? cellString(getByPath(rec, tsKey)) : "";

  return {
    ts: tsRaw,
    channel: normalizeChannelLabel(channelRaw),
    sender: senderKey ? cellString(getByPath(rec, senderKey)) || "unknown" : "unknown",
    text,
    permalink: permalink || undefined,
    threadTs: threadTs || undefined,
  };
}

function formatMessageLine(msg: CanonicalMessage, tsKind: TsKind): string {
  const d = parseTimestampValue(msg.ts, tsKind);
  const when = d ? formatDateTimeLocal(d) : msg.ts || "?";
  const channel = msg.channel ? `#${msg.channel}` : "";
  const threadMark =
    msg.threadTs && msg.threadTs !== msg.ts ? ` thread:${msg.threadTs}` : "";
  const head = [`[${when}]`, channel, msg.sender].filter(Boolean).join(" ");
  return `${head}${threadMark}: ${msg.text}`;
}

function messagesToResult(
  messages: CanonicalMessage[],
  tsKind: TsKind,
  notes: string[],
  appliedConfig: ImportMappingConfig,
): NormalizeObservationResult {
  if (messages.length === 0) {
    return { detected: false, text: "", messageCount: 0, notes, appliedConfig };
  }
  const sorted = [...messages].sort((a, b) => {
    const da = parseTimestampValue(a.ts, tsKind)?.getTime() ?? 0;
    const db = parseTimestampValue(b.ts, tsKind)?.getTime() ?? 0;
    return da - db;
  });
  const dates = sorted
    .map((m) => parseTimestampValue(m.ts, tsKind))
    .filter((d): d is Date => !!d)
    .map(formatDateYmd)
    .sort();
  return {
    detected: true,
    text: sorted.map((m) => formatMessageLine(m, tsKind)).join("\n"),
    messageCount: sorted.length,
    occurredRangeHint:
      dates.length > 0 ? { start: dates[0], end: dates[dates.length - 1] } : undefined,
    notes,
    appliedConfig,
  };
}

/**
 * 列マッピング指定時のみ構造化ログを平文へ変換する。
 * マッピング無しなら原文のまま（detected:false）。
 */
export function normalizeObservationInput(
  text: string,
  config?: ImportMappingConfig,
): NormalizeObservationResult {
  const trimmed = text.trim();
  if (!trimmed) {
    return { detected: false, text: "", messageCount: 0, notes: [] };
  }

  if (!config || config.syntax === "plain") {
    return {
      detected: false,
      text: trimmed,
      messageCount: 0,
      notes: config?.syntax === "plain" ? ["平文として正規化をスキップしました"] : [],
      appliedConfig: config,
    };
  }

  if (!Object.values(config.fieldMapping).includes("text")) {
    return {
      detected: false,
      text: trimmed,
      messageCount: 0,
      notes: ["本文(text)列の対応が必要です"],
      appliedConfig: config,
    };
  }
  const records = recordsFromConfig(trimmed, config);
  const messages: CanonicalMessage[] = [];
  for (const rec of records) {
    const msg = applyMapping(rec, config.fieldMapping, config.tsKind);
    if (msg) messages.push(msg);
  }
  const notes = [
    `${config.syntax.toUpperCase()} を列マッピングで ${messages.length} 件の平文に正規化しました`,
  ];
  return messagesToResult(messages, config.tsKind, notes, config);
}

const DEFAULT_JSONL_MAPPING: FieldMapping = {
  ts: "ts",
  channel: "channel",
  sender: "sender",
  text: "text",
  permalink: "permalink",
};

/** テスト用: 明示マッピングで1行をパース */
export function parseSlackJsonlLine(line: string): CanonicalMessage | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed[0] !== "{") return null;
  try {
    const rec = JSON.parse(trimmed) as Record<string, unknown>;
    return applyMapping(rec, DEFAULT_JSONL_MAPPING, "slack");
  } catch {
    return null;
  }
}

/** テスト用 */
export function parseSlackJsonlMessages(text: string): CanonicalMessage[] {
  return parseJsonlRecords(text)
    .map((rec) => applyMapping(rec, DEFAULT_JSONL_MAPPING, "slack"))
    .filter((m): m is CanonicalMessage => !!m)
    .sort((a, b) => {
      const da = parseTimestampValue(a.ts, "slack")?.getTime() ?? 0;
      const db = parseTimestampValue(b.ts, "slack")?.getTime() ?? 0;
      return da - db;
    });
}

/** テスト用: JSONL らしい行が過半か */
export function detectSlackJsonl(text: string): boolean {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return false;
  let ok = 0;
  for (const line of lines) {
    if (parseSlackJsonlLine(line)) ok += 1;
  }
  return ok >= Math.max(1, Math.ceil(lines.length * 0.5));
}
