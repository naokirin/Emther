import { randomUUID } from "node:crypto";
import { pipeline } from "@huggingface/transformers";

// 重要: ジャーナルには人名・心情などの機微情報が含まれうるため、この抽出処理は
// 外部サービス（claude -p を含む）に一切送信せず、完全にローカル（Transformers.js / WASM,
// ONNX Runtime）で完結させる。docs 3.2「サニタイズ（秘匿化）」および業務要求3「情報の壁と
// セキュリティ」に対応するための必須要件であり、コストや速度のための最適化ではない。
// （タスク実行を担うLead/People/Process/Tech Agent側は、EMが要約・匿名化した上で
// 明示的に相談する用途のため claude -p を使う方針のまま。こちらは別の関心事。）

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

// ローカル推論モデル。1.5B(q4, ~1.8GB)の方が人物抽出やJSON整形の精度は高かったが、
// このリポジトリの検証環境（メモリ7.7GB、常時スワップ逼迫気味）ではリクエスト後にプロセスが
// 落ちることを複数回確認したため、安定性を優先して0.5Bを採用（検証結果はweb/README.md参照）。
// より余裕のあるマシンで動かす場合は1.5B系へ差し替えて構わない。
// 初回リクエスト時に重みをダウンロードし、以降はローカルキャッシュから読み込む。
const MODEL_ID = "onnx-community/Qwen2.5-0.5B-Instruct";
const MODEL_DTYPE = "q4";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let generatorPromise: Promise<any> | null = null;

function getGenerator() {
  if (!generatorPromise) {
    generatorPromise = pipeline("text-generation", MODEL_ID, { dtype: MODEL_DTYPE });
  }
  return generatorPromise;
}

const SYSTEM_PROMPT = [
  "あなたはメモから情報を抽出し、JSONだけを出力するツールです。説明や前置きは一切書かず、JSONオブジェクト1つだけを出力してください。",
  'フォーマット: {"tags": string[], "people": string[], "urgency": "low"|"mid"|"high", "sentiment": "positive"|"negative"|"neutral", "summary": string}',
  "tagsは日本語の短い単語（例: 技術的負債, 1on1）。peopleは文中の人物名（敬称はそのまま、例: Aさん）。",
  "メモに書かれていない情報を推測で埋めないこと。該当が無ければ空配列にすること。",
].join("\n");

// 人物が「いる」例と「いない」例の両方を見せることで、0.5Bモデルがpeopleを
// 空配列に倒しがちな傾向を緩和する。
const FEW_SHOT_EXAMPLES: Array<{ user: string; assistant: string }> = [
  {
    user: "経営会議。Q3のエンタープライズ向けリリース日が2週間前倒しになった。",
    assistant: JSON.stringify({
      tags: ["経営会議", "スケジュール変更"],
      people: [],
      urgency: "high",
      sentiment: "negative",
      summary: "Q3のリリース日が2週間前倒しになった",
    }),
  },
  {
    user: "CさんのPRレビューが非常に速く、品質も良い。褒めた。",
    assistant: JSON.stringify({
      tags: ["PRレビュー", "パフォーマンス"],
      people: ["Cさん"],
      urgency: "low",
      sentiment: "positive",
      summary: "Cさんのレビューが速く高品質だったので褒めた",
    }),
  },
];

function isUrgency(v: unknown): v is Urgency {
  return v === "low" || v === "mid" || v === "high";
}

function isSentiment(v: unknown): v is Sentiment {
  return v === "positive" || v === "negative" || v === "neutral";
}

// 小型モデルは正しいJSONを出した後も生成を止めずに繰り返すことがあるため、
// 最初に現れる釣り合いの取れた{...}だけを取り出す。
function extractFirstJsonObject(text: string): string | undefined {
  const start = text.indexOf("{");
  if (start === -1) return undefined;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return undefined;
}

export async function addJournalEntry(rawText: string): Promise<JournalEntry> {
  const generator = await getGenerator();

  const output = await generator(
    [
      { role: "system", content: SYSTEM_PROMPT },
      ...FEW_SHOT_EXAMPLES.flatMap((ex) => [
        { role: "user", content: ex.user },
        { role: "assistant", content: ex.assistant },
      ]),
      { role: "user", content: rawText },
    ],
    { max_new_tokens: 200, do_sample: false },
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const messages = (output as any)[0]?.generated_text as Array<{ role: string; content: string }> | undefined;
  const content = messages?.at(-1)?.content ?? "";
  const jsonText = extractFirstJsonObject(content);
  if (!jsonText) {
    throw new Error("ローカルモデルの出力からJSONを抽出できませんでした");
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let structured: any;
  try {
    structured = JSON.parse(jsonText);
  } catch {
    throw new Error("ローカルモデルの出力が不正なJSONでした");
  }

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
