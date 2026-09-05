import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function execFileAsync(cmd: string, args: string[], opts?: any): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { encoding: "utf8", ...opts }, (err, stdout, stderr) => {
      const out = stdout.toString();
      const errOut = stderr.toString();
      if (err) {
        reject(Object.assign(err, { stdout: out, stderr: errOut }));
      } else {
        resolve({ stdout: out, stderr: errOut });
      }
    });
  });
}

export type Urgency = "low" | "mid" | "high";
export type Sentiment = "positive" | "negative" | "neutral";

export type JournalEntry = {
  id: string;
  rawText: string;
  tags: string[];
  people: string[];
  urgency: Urgency;
  sentiment: Sentiment;
  summary: string;
  createdAt: number;
};

// MVPではプロセス内メモリのみ。Daily Logs DBとしての永続化は今後の課題（README参照）。
const entries: JournalEntry[] = [];

// 軽量モデル: タグ付けだけの単純作業に高価なモデルを使わないため、docs 3.2の「軽量モデルによるIngestion」に対応。
const TAGGING_MODEL = "claude-haiku-4-5-20251001";

const SCHEMA = JSON.stringify({
  type: "object",
  properties: {
    tags: { type: "array", items: { type: "string" } },
    people: { type: "array", items: { type: "string" } },
    urgency: { type: "string", enum: ["low", "mid", "high"] },
    sentiment: { type: "string", enum: ["positive", "negative", "neutral"] },
    summary: { type: "string" },
  },
  required: ["tags", "people", "urgency", "sentiment", "summary"],
});

const SYSTEM_PROMPT = [
  "あなたはEM(エンジニアリングマネージャー)支援システムのジャーナル自動タグ付けを行う軽量モデルです。",
  "与えられた雑多な一言メモから、以下をJSONで抽出してください。",
  "- tags: 話題を表す短い日本語の単語の配列（例: 技術的負債, 1on1, モチベーション低下）。英語や#記号は付けない。",
  "- people: 登場する人物名の配列（敬称なし、例: A, Bさんではなく B）。",
  "- urgency: low/mid/high のいずれか。",
  "- sentiment: positive/negative/neutral のいずれか。",
  "- summary: 一文の要約。",
  "メモに書かれていない情報を推測で埋めないこと。人物や話題が無ければ空配列にすること。",
].join("\n");

function isUrgency(v: unknown): v is Urgency {
  return v === "low" || v === "mid" || v === "high";
}

function isSentiment(v: unknown): v is Sentiment {
  return v === "positive" || v === "negative" || v === "neutral";
}

export async function addJournalEntry(rawText: string): Promise<JournalEntry> {
  const { stdout } = await execFileAsync("claude", [
    "-p",
    rawText,
    "--model",
    TAGGING_MODEL,
    "--tools",
    "",
    "--output-format",
    "json",
    "--json-schema",
    SCHEMA,
    "--append-system-prompt",
    SYSTEM_PROMPT,
  ]);

  const parsed = JSON.parse(stdout);
  if (parsed.is_error) {
    throw new Error(`タグ付けに失敗しました: ${parsed.result ?? "unknown error"}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const structured: any = parsed.structured_output ?? JSON.parse(parsed.result);

  const entry: JournalEntry = {
    id: randomUUID(),
    rawText,
    tags: Array.isArray(structured.tags) ? structured.tags.filter((t: unknown) => typeof t === "string") : [],
    people: Array.isArray(structured.people) ? structured.people.filter((p: unknown) => typeof p === "string") : [],
    urgency: isUrgency(structured.urgency) ? structured.urgency : "mid",
    sentiment: isSentiment(structured.sentiment) ? structured.sentiment : "neutral",
    summary: typeof structured.summary === "string" ? structured.summary : "",
    createdAt: Date.now(),
  };

  entries.unshift(entry);
  return entry;
}

export function listJournalEntries(): JournalEntry[] {
  return entries;
}
