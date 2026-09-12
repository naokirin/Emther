import { randomUUID } from "node:crypto";
import { extractFirstJsonObject } from "@/lib/local-model";
import { runCloudChat } from "@/lib/cloud-chat";
import { maskNames, unmaskNames } from "@/lib/people-directory";
import type { ChunkDraft, ObservationSourceType } from "@/lib/observation-dump-store";

// docs/observation_dump_journal.md §6: マスク済み本文のみを外部AIへ渡し、原文抜粋チャンクを提案する。

export const MAX_OBSERVATION_CHUNKS = 30;
/** クラウドへ一度に渡す文字数目安（超えたらヒューリスティック分割後に先頭から） */
const MAX_CLOUD_CHARS = 24000;

const COMMON_RULES = [
  "あなたはEM向けの観測ログを、Journal用の事実かたまりに分割するツールです。",
  "説明・前置き・Markdownフェンスは書かず、JSONオブジェクト1つだけを出力してください。",
  'フォーマット: {"chunks":[{"text":string,"occurredAtHint":string|null,"people":string[],"tags":string[],"confidence":number,"dropReason":null}],"droppedNotes":string[]}',
  "textは原文からの抜粋（要約・言い換え禁止）。短い整形（改行整理・話者ラベルの整理）のみ可。",
  "1チャンクはおおよそ1〜5文、または議題1つ／スレッド結論1つ。",
  "人名は入力に含まれる表記（PERSON_n を含む）をそのまま使う。新しい実名を発明しない。",
  "occurredAtHintは分かるときだけ YYYY-MM-DD。不明なら null。",
  "confidenceは0〜1。残す価値が低い区間はchunksに入れずdroppedNotesへ。",
  `chunksは最大${MAX_OBSERVATION_CHUNKS}件。`,
].join("\n");

const SOURCE_RULES: Record<ObservationSourceType, string> = {
  chat_log: [
    "入力はチャットログ（Slack等）です。",
    "残す: 合意・依頼・懸念・エスカレーション・人の状態に触れる発言、スレッド結論。",
    "捨てる: 雑談、スタンプのみ、ボット通知の羅列、重複リアクション。",
  ].join("\n"),
  meeting_log: [
    "入力は会議の議事メモまたは文字起こしです。",
    "残す: 議題ごとの決定・未決・アクション・空気／リスクの感知。",
    "捨てる: アジェンダ読み上げ、相槌、議題と無関係な脱線（必要なら1チャンクに圧縮可）。",
  ].join("\n"),
  other_log: [
    "入力はその他の業務ログ（メール要約、インシデントメモ、週報の切り出し等）です。",
    "残す: 組織感知として残すべき事実・揺らぎ。",
    "捨てる: 手続き通知のみ、重複する定型文。",
  ].join("\n"),
};

function systemPromptFor(sourceType: ObservationSourceType): string {
  return `${COMMON_RULES}\n${SOURCE_RULES[sourceType]}`;
}

type ModelChunk = {
  text: string;
  occurredAtHint?: string | null;
  people?: unknown;
  tags?: unknown;
  confidence?: unknown;
  dropReason?: string | null;
};

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((s) => s.trim());
}

function normalizeChunk(raw: ModelChunk): ChunkDraft | null {
  const text = typeof raw.text === "string" ? raw.text.trim() : "";
  if (!text) return null;
  const confidence =
    typeof raw.confidence === "number" && Number.isFinite(raw.confidence)
      ? Math.min(1, Math.max(0, raw.confidence))
      : 0.5;
  const hint =
    typeof raw.occurredAtHint === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.occurredAtHint.trim())
      ? raw.occurredAtHint.trim()
      : undefined;
  return {
    id: randomUUID(),
    textMasked: maskNames(text),
    suggestedOccurredAt: hint,
    people: asStringArray(raw.people).map(maskNames),
    tags: asStringArray(raw.tags).map(maskNames),
    confidence,
    disposition: "pending",
    dropReason:
      typeof raw.dropReason === "string" && raw.dropReason.trim()
        ? maskNames(raw.dropReason.trim())
        : undefined,
  };
}

function parseModelPayload(structured: unknown): { chunks: ChunkDraft[]; droppedNotes: string[] } {
  if (!structured || typeof structured !== "object") return { chunks: [], droppedNotes: [] };
  const obj = structured as { chunks?: unknown; droppedNotes?: unknown };
  const chunks: ChunkDraft[] = [];
  if (Array.isArray(obj.chunks)) {
    for (const item of obj.chunks) {
      if (!item || typeof item !== "object") continue;
      const c = normalizeChunk(item as ModelChunk);
      if (c) chunks.push(c);
      if (chunks.length >= MAX_OBSERVATION_CHUNKS) break;
    }
  }
  const droppedNotes = asStringArray(obj.droppedNotes).map(maskNames);
  return { chunks, droppedNotes };
}

/** 段落／空行、またはタイムスタンプっぽい行頭で分割。最後の手段は全文1チャンク。 */
export function parseObservationHeuristic(maskedText: string): {
  chunks: ChunkDraft[];
  droppedNotes: string[];
} {
  const trimmed = maskedText.trim();
  if (!trimmed) return { chunks: [], droppedNotes: [] };

  const paragraphs = trimmed
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  let parts = paragraphs.length >= 2 ? paragraphs : [];

  if (parts.length < 2) {
    // Slack風: [HH:MM] や 名前: で始まる行の塊
    const lines = trimmed.split("\n");
    const buckets: string[] = [];
    let buf: string[] = [];
    const flush = () => {
      const t = buf.join("\n").trim();
      if (t) buckets.push(t);
      buf = [];
    };
    for (const line of lines) {
      const startsUnit =
        /^[\[【]?\d{1,2}:\d{2}/.test(line.trim()) ||
        /^[^:]{1,40}:\s+\S/.test(line.trim());
      if (startsUnit && buf.length > 0) flush();
      buf.push(line);
    }
    flush();
    if (buckets.length >= 2) parts = buckets;
  }

  if (parts.length < 2) {
    return {
      chunks: [
        {
          id: randomUUID(),
          textMasked: trimmed.slice(0, 4000),
          people: [],
          tags: [],
          confidence: 0.3,
          disposition: "pending",
        },
      ],
      droppedNotes: trimmed.length > 4000 ? ["末尾は長さ制限により切り詰めました"] : [],
    };
  }

  // 極端に短い破片（相槌一行など）だけ隣へ結合する
  const merged: string[] = [];
  for (const p of parts) {
    if (merged.length > 0 && p.length < 12) {
      merged[merged.length - 1] = `${merged[merged.length - 1]}\n${p}`;
    } else {
      merged.push(p);
    }
  }

  const chunks = merged.slice(0, MAX_OBSERVATION_CHUNKS).map((text) => ({
    id: randomUUID(),
    textMasked: text,
    people: [] as string[],
    tags: [] as string[],
    confidence: 0.4,
    disposition: "pending" as const,
  }));

  return {
    chunks,
    droppedNotes:
      merged.length > MAX_OBSERVATION_CHUNKS
        ? [`提案上限（${MAX_OBSERVATION_CHUNKS}）を超えたため以降を省略`]
        : [],
  };
}

export type ParseObservationResult = {
  chunks: ChunkDraft[];
  droppedNotes: string[];
  source: "cloud" | "heuristic";
};

/**
 * 長いマスク済み本文を、空行／行境界を優先して MAX_CLOUD_CHARS 以下の窓に切る。
 * 1窓がそれでも超える場合だけ硬くスライスする。
 */
export function splitMaskedTextIntoWindows(
  maskedText: string,
  maxChars: number = MAX_CLOUD_CHARS,
): string[] {
  const trimmed = maskedText.trim();
  if (!trimmed) return [];
  if (trimmed.length <= maxChars) return [trimmed];

  const paragraphs = trimmed.split(/\n\s*\n/);
  const windows: string[] = [];
  let buf = "";

  const pushBuf = () => {
    const t = buf.trim();
    if (t) windows.push(t);
    buf = "";
  };

  for (const para of paragraphs) {
    const piece = para.trim();
    if (!piece) continue;
    const candidate = buf ? `${buf}\n\n${piece}` : piece;
    if (candidate.length <= maxChars) {
      buf = candidate;
      continue;
    }
    pushBuf();
    if (piece.length <= maxChars) {
      buf = piece;
      continue;
    }
    // 単一段落が上限超え: 行単位、それでもダメなら硬切り
    const lines = piece.split("\n");
    let lineBuf = "";
    for (const line of lines) {
      const next = lineBuf ? `${lineBuf}\n${line}` : line;
      if (next.length <= maxChars) {
        lineBuf = next;
        continue;
      }
      if (lineBuf.trim()) windows.push(lineBuf.trim());
      if (line.length <= maxChars) {
        lineBuf = line;
      } else {
        for (let i = 0; i < line.length; i += maxChars) {
          windows.push(line.slice(i, i + maxChars));
        }
        lineBuf = "";
      }
    }
    buf = lineBuf;
  }
  pushBuf();
  return windows.length > 0 ? windows : [trimmed.slice(0, maxChars)];
}

async function parseOneWindow(
  sourceType: ObservationSourceType,
  windowText: string,
  windowIndex: number,
  windowCount: number,
): Promise<{ chunks: ChunkDraft[]; droppedNotes: string[] }> {
  try {
    const userPrompt = [
      "次のマスク済み観測テキストを、指定フォーマットのJSONに分割してください。",
      "textは原文抜粋のみ（要約禁止）。",
      ...(windowCount > 1
        ? [`（全体の ${windowIndex + 1}/${windowCount} 部分です。この部分だけを分割してください）`]
        : []),
      "",
      "変換対象:",
      windowText,
    ].join("\n");

    const content = await runCloudChat(systemPromptFor(sourceType), userPrompt);
    const jsonText = extractFirstJsonObject(content);
    if (!jsonText) return { chunks: [], droppedNotes: [] };
    try {
      return parseModelPayload(JSON.parse(jsonText));
    } catch {
      return { chunks: [], droppedNotes: [] };
    }
  } catch {
    return { chunks: [], droppedNotes: [] };
  }
}

export async function parseObservationDumpText(
  sourceType: ObservationSourceType,
  maskedText: string,
): Promise<ParseObservationResult> {
  const trimmed = maskedText.trim();
  if (!trimmed) return { chunks: [], droppedNotes: [], source: "heuristic" };

  const heuristic = parseObservationHeuristic(trimmed);
  const windows = splitMaskedTextIntoWindows(trimmed);

  const allChunks: ChunkDraft[] = [];
  const allDropped: string[] = [];
  let anyCloud = false;

  for (let i = 0; i < windows.length; i++) {
    if (allChunks.length >= MAX_OBSERVATION_CHUNKS) {
      allDropped.push(
        `提案上限（${MAX_OBSERVATION_CHUNKS}）に達したため、残り ${windows.length - i} 部分の分割を省略しました`,
      );
      break;
    }
    const part = await parseOneWindow(sourceType, windows[i], i, windows.length);
    if (part.chunks.length > 0) anyCloud = true;
    for (const note of part.droppedNotes) allDropped.push(note);
    for (const c of part.chunks) {
      allChunks.push(c);
      if (allChunks.length >= MAX_OBSERVATION_CHUNKS) break;
    }
  }

  if (anyCloud && allChunks.length > 0) {
    if (windows.length > 1) {
      allDropped.push(`長い入力を ${windows.length} 部分に分けて分割しました`);
    }
    return {
      chunks: allChunks.slice(0, MAX_OBSERVATION_CHUNKS),
      droppedNotes: allDropped,
      source: "cloud",
    };
  }
  return { ...heuristic, source: "heuristic" };
}

/** テスト／デバッグ用: マスク済みチャンクを表示用に戻す */
export function unmaskChunkTexts(chunks: ChunkDraft[]): Array<ChunkDraft & { text: string }> {
  return chunks.map((c) => ({ ...c, text: unmaskNames(c.textMasked) }));
}
