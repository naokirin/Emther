// Slack bookmarklet / エクスポート由来の JSONL を、chat_log 分割向けの平文に正規化する。
// 想定例:
// {"ts":"1779701310.701429","channel":"test_channel","sender":"taro.tanaka","text":"...","permalink":"...","thread":{...}}

export type SlackJsonlMessage = {
  ts: string;
  channel: string;
  sender: string;
  text: string;
  permalink?: string;
  threadTs?: string;
  threadSkipped?: boolean;
  threadSkipReason?: string;
};

export type NormalizeSlackJsonlResult = {
  detected: boolean;
  text: string;
  messageCount: number;
  occurredRangeHint?: { start: string; end: string };
  notes: string[];
};

const CHANNEL_THREAD_PREFIX = /^スレッドの場所\s*:\s*/;

/** Slack ts（秒.小数）またはミリ秒っぽい数値文字列 → Date。失敗時 undefined */
export function parseSlackTs(ts: string | number | undefined): Date | undefined {
  if (ts === undefined || ts === null) return undefined;
  const raw = String(ts).trim();
  if (!raw) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  // 1e12 超はミリ秒、それ以外は Slack 秒（小数可）
  const ms = n >= 1e12 ? n : n * 1000;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? undefined : d;
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

function extractThreadTs(permalink: unknown, thread: unknown): string | undefined {
  if (typeof permalink === "string") {
    const m = permalink.match(/[?&]thread_ts=([0-9.]+)/);
    if (m) return m[1];
  }
  if (thread && typeof thread === "object") {
    const t = thread as Record<string, unknown>;
    if (typeof t.ts === "string") return t.ts;
    if (typeof t.thread_ts === "string") return t.thread_ts;
  }
  return undefined;
}

export function parseSlackJsonlLine(line: string): SlackJsonlMessage | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed[0] !== "{") return null;
  let obj: unknown;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;
  const rec = obj as Record<string, unknown>;
  const text = typeof rec.text === "string" ? rec.text.trim() : "";
  if (!text) return null;
  const ts = rec.ts !== undefined && rec.ts !== null ? String(rec.ts) : "";
  const sender = typeof rec.sender === "string" ? rec.sender.trim() : "";
  const channelRaw = typeof rec.channel === "string" ? rec.channel : "";
  if (!ts && !sender) return null;

  const thread = rec.thread;
  let threadSkipped: boolean | undefined;
  let threadSkipReason: string | undefined;
  if (thread && typeof thread === "object") {
    const t = thread as Record<string, unknown>;
    if (t.skipped === true) threadSkipped = true;
    if (typeof t.reason === "string") threadSkipReason = t.reason;
  }

  return {
    ts,
    channel: normalizeChannelLabel(channelRaw),
    sender: sender || "unknown",
    text,
    permalink: typeof rec.permalink === "string" ? rec.permalink : undefined,
    threadTs: extractThreadTs(rec.permalink, thread),
    threadSkipped,
    threadSkipReason,
  };
}

/** 非空行の過半が Slack JSONL メッセージなら detected */
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

export function parseSlackJsonlMessages(text: string): SlackJsonlMessage[] {
  const out: SlackJsonlMessage[] = [];
  for (const line of text.split("\n")) {
    const msg = parseSlackJsonlLine(line);
    if (msg) out.push(msg);
  }
  return out.sort((a, b) => {
    const da = parseSlackTs(a.ts)?.getTime() ?? 0;
    const db = parseSlackTs(b.ts)?.getTime() ?? 0;
    return da - db;
  });
}

function formatMessageLine(msg: SlackJsonlMessage): string {
  const d = parseSlackTs(msg.ts);
  const when = d ? formatDateTimeLocal(d) : msg.ts || "?";
  const channel = msg.channel ? `#${msg.channel}` : "";
  const threadMark =
    msg.threadTs && msg.threadTs !== msg.ts ? ` thread:${msg.threadTs}` : "";
  const head = [`[${when}]`, channel, msg.sender].filter(Boolean).join(" ");
  return `${head}${threadMark}: ${msg.text}`;
}

/**
 * Slack JSONL を検出したら平文チャットログへ変換する。
 * 非検出時は detected:false で text は入力のまま。
 */
export function normalizeObservationInput(text: string): NormalizeSlackJsonlResult {
  const trimmed = text.trim();
  if (!trimmed || !detectSlackJsonl(trimmed)) {
    return { detected: false, text: trimmed, messageCount: 0, notes: [] };
  }

  const messages = parseSlackJsonlMessages(trimmed);
  if (messages.length === 0) {
    return { detected: false, text: trimmed, messageCount: 0, notes: [] };
  }

  const dates = messages
    .map((m) => parseSlackTs(m.ts))
    .filter((d): d is Date => !!d)
    .map(formatDateYmd)
    .sort();
  const occurredRangeHint =
    dates.length > 0 ? { start: dates[0], end: dates[dates.length - 1] } : undefined;

  const notes = [
    `Slack JSONL を ${messages.length} 件のメッセージ平文に正規化しました`,
  ];
  const skipped = messages.filter((m) => m.threadSkipped).length;
  if (skipped > 0) {
    notes.push(`thread.skipped 付き ${skipped} 件（本文は残しています）`);
  }

  return {
    detected: true,
    text: messages.map(formatMessageLine).join("\n"),
    messageCount: messages.length,
    occurredRangeHint,
    notes,
  };
}
