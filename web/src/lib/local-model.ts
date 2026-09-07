import { pipeline } from "@huggingface/transformers";

// このモジュールが提供するローカル推論は、機微情報を外部に一切送信しないことが目的。
// journal-store.ts（ジャーナルの自動タグ付け）と people-directory.ts 経由の
// agent-runtime.ts（クラウドLLMに送る前の人物名検出）の両方から共有で使う。
//
// モデルサイズはこのリポジトリの検証環境（メモリ7.7GB、常時スワップ逼迫気味）での安定性を
// 優先して0.5Bを採用（1.5Bだとリクエスト後にプロセスが落ちることを複数回確認した）。
// 2026-09-08にも1.5Bへの切り替えを再検証したが、1リクエストでnext-serverのRSSが
// 約5GBまで増加してシステム空きメモリが150MB台まで低下し、生成自体も
// JSON抽出失敗（500）に終わったため0.5Bへ差し戻した。
// より余裕のあるマシンで動かす場合はMODEL_ID/MODEL_DTYPEを差し替えるとよい。
const MODEL_ID = "onnx-community/Qwen2.5-0.5B-Instruct";
const MODEL_DTYPE = "q4";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let generatorPromise: Promise<any> | null = null;

export function getLocalGenerator() {
  if (!generatorPromise) {
    generatorPromise = pipeline("text-generation", MODEL_ID, { dtype: MODEL_DTYPE });
  }
  return generatorPromise;
}

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export async function runLocalChat(messages: ChatMessage[], maxNewTokens: number): Promise<string> {
  const generator = await getLocalGenerator();
  const output = await generator(messages, { max_new_tokens: maxNewTokens, do_sample: false });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const generated = (output as any)[0]?.generated_text as ChatMessage[] | undefined;
  return generated?.at(-1)?.content ?? "";
}

// 小型モデルは正しいJSONを出した後も生成を止めずに繰り返すことがあるため、
// 最初に現れる釣り合いの取れた{...}だけを取り出す。
export function extractFirstJsonObject(text: string): string | undefined {
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
