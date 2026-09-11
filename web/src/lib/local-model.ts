import { pipeline, type ProgressCallback } from "@huggingface/transformers";

// このモジュールが提供するローカル推論は、機微情報を外部に一切送信しないことが目的。
// journal-store.ts（ジャーナルの自動タグ付け）と people-directory.ts 経由の
// agent-runtime.ts（クラウドLLMに送る前の人物名検出）の両方から共有で使う。
//
// モデルサイズはこのリポジトリの検証環境（メモリ7.7GB、常時スワップ逼迫気味）での安定性を
// 優先して小型モデルを採用（1.5Bだとリクエスト後にプロセスが落ちることを複数回確認した）。
// 2026-09-08にも1.5Bへの切り替えを再検証したが、1リクエストでnext-serverのRSSが
// 約5GBまで増加してシステム空きメモリが150MB台まで低下し、生成自体も
// JSON抽出失敗（500）に終わったため小型へ差し戻した。
// 当初は Qwen2.5-0.5B-Instruct を使っていたが、要約などが中国語に寄りやすいため、
// 日本語を含む多言語対応の LFM2.5-350M へ切り替えた。
// （同規模の日本語特化 Sarashina2.2-0.5B の onnx-community 版は tokenizer 欠落で
// Transformers.js から使えなかった。）
// より余裕のあるマシンで動かす場合はLOCAL_CHAT_MODELを差し替えるとよい。
//
// 未キャッシュ時の起動ダウンロード＋進捗表示は model-loader.ts が担う。
export const LOCAL_CHAT_MODEL = {
  task: "text-generation" as const,
  id: "onnx-community/LFM2.5-350M-ONNX",
  dtype: "q4" as const,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let generatorPromise: Promise<any> | null = null;

export function getLocalGenerator(progress_callback?: ProgressCallback) {
  if (!generatorPromise) {
    generatorPromise = pipeline(LOCAL_CHAT_MODEL.task, LOCAL_CHAT_MODEL.id, {
      dtype: LOCAL_CHAT_MODEL.dtype,
      progress_callback,
    });
  }
  return generatorPromise;
}

/** pipeline() 失敗後に再試行できるよう、拒否済み Promise を捨てる。 */
export function clearLocalGeneratorCache() {
  generatorPromise = null;
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
