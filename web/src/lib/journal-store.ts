import { randomUUID } from "node:crypto";
import { extractFirstJsonObject, runLocalChat } from "@/lib/local-model";
import { registerName } from "@/lib/people-directory";

// 重要: ジャーナルには人名・心情などの機微情報が含まれうるため、この抽出処理は
// 外部サービス（claude -p を含む）に一切送信せず、完全にローカル（Transformers.js / WASM,
// ONNX Runtime）で完結させる。docs 3.2「サニタイズ（秘匿化）」および業務要求3「情報の壁と
// セキュリティ」に対応するための必須要件であり、コストや速度のための最適化ではない。
// 抽出したpeopleはpeople-directory.tsに登録し、Agent Runtime（クラウド）に送る際の
// 匿名化（docs/memo.md）に再利用する。

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

export async function addJournalEntry(rawText: string): Promise<JournalEntry> {
  const content = await runLocalChat(
    [
      { role: "system", content: SYSTEM_PROMPT },
      ...FEW_SHOT_EXAMPLES.flatMap((ex) => [
        { role: "user" as const, content: ex.user },
        { role: "assistant" as const, content: ex.assistant },
      ]),
      { role: "user", content: rawText },
    ],
    200,
  );

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

  const people: string[] = Array.isArray(structured.people)
    ? structured.people.filter((p: unknown): p is string => typeof p === "string")
    : [];
  for (const person of people) {
    registerName(person);
  }

  const entry: JournalEntry = {
    id: randomUUID(),
    rawText,
    tags: Array.isArray(structured.tags) ? structured.tags.filter((t: unknown) => typeof t === "string") : [],
    people,
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
