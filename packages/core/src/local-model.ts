import "./transformers-env";
import { pipeline, type ProgressCallback } from "@huggingface/transformers";
import {
  DEFAULT_LOCAL_CHAT_MODEL,
  isLocalChatModelPresetId,
  LOCAL_CHAT_MODEL_PRESETS,
  type LocalChatModelPresetId,
  type LocalChatModelSpec,
} from "./local-chat-presets";
import { getRulesAndConstraints } from "./settings-store";
import { getTransformersCacheDir } from "./transformers-env";

// このモジュールが提供するローカル推論は、機微情報を外部に一切送信しないことが目的。
// journal-store.ts（ジャーナルの自動タグ付け）と people-directory.ts 経由の
// agent-runtime.ts（クラウドLLMに送る前の人物名検出）の両方から共有で使う。
//
// 既定は検証環境（メモリ7.7GB、常時スワップ逼迫気味）での安定性を優先した 350M。
// 1.5Bは人物抽出やJSON整形の精度は高いが、同環境では1リクエストでnext-serverのRSSが
// 約5GBまで増加して空きメモリが逼迫し、生成失敗に至った実績がある。
// メモリに余裕があるマシンでは設定（localChatModelPreset）で
// 0.5B / 1.2B / 1.2B-JP / 1.5B を選べる。
//
// プリセット定義本体は local-chat-presets.ts（UIからも参照するため分離）。
// 未キャッシュ時の起動ダウンロード＋進捗表示は model-loader.ts が担う。

export type { LocalChatModelPresetId, LocalChatModelSpec };
export {
  DEFAULT_LOCAL_CHAT_MODEL as LOCAL_CHAT_MODEL,
  isLocalChatModelPresetId,
  LOCAL_CHAT_MODEL_PRESET_IDS,
  LOCAL_CHAT_MODEL_PRESETS,
} from "./local-chat-presets";

/** 現在の設定に対応するチャットモデル仕様。不正値は 350m にフォールバック。 */
export function getLocalChatModel(): LocalChatModelSpec {
  const preset = getRulesAndConstraints().localChatModelPreset;
  if (isLocalChatModelPresetId(preset)) return LOCAL_CHAT_MODEL_PRESETS[preset];
  return DEFAULT_LOCAL_CHAT_MODEL;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let generatorPromise: Promise<any> | null = null;
/** 現在キャッシュしている pipeline のモデルID。設定切替検知用。 */
let loadedModelId: string | null = null;
let generatorReady = false;
let lastLoadFailed = false;

function isGeneratorLoadPending(): boolean {
  return generatorPromise !== null && !generatorReady;
}

/** 起動時ダウンロード中・前回失敗・ハング中なら true。推論経路は待たずに諦める。 */
export function isLocalGeneratorBusyOrFailed(): boolean {
  return lastLoadFailed || isGeneratorLoadPending();
}

export function getLocalGenerator(progress_callback?: ProgressCallback) {
  const model = getLocalChatModel();
  if (generatorPromise && loadedModelId !== model.id) {
    clearLocalGeneratorCache();
  }
  if (!generatorPromise) {
    loadedModelId = model.id;
    generatorReady = false;
    lastLoadFailed = false;
    const resultPromise = pipeline(model.task, model.id, {
      dtype: model.dtype,
      progress_callback,
      cache_dir: getTransformersCacheDir(),
    }).then(
      (generator) => {
        if (generatorPromise !== resultPromise) return generator;
        generatorReady = true;
        lastLoadFailed = false;
        return generator;
      },
      (err) => {
        if (generatorPromise === resultPromise) markLocalGeneratorUnavailable();
        throw err;
      },
    );
    generatorPromise = resultPromise;
  }
  return generatorPromise;
}

/** pipeline() 失敗後・プリセット切替時に再試行できるよう、拒否済み Promise を捨てる。 */
export function clearLocalGeneratorCache() {
  generatorPromise = null;
  loadedModelId = null;
  generatorReady = false;
  lastLoadFailed = false;
}

/** ハング／失敗を呼び出し元に見せたあと、同じ pending Promise を再利用しない。 */
export function markLocalGeneratorUnavailable() {
  generatorPromise = null;
  loadedModelId = null;
  generatorReady = false;
  lastLoadFailed = true;
}

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export async function runLocalChat(messages: ChatMessage[], maxNewTokens: number): Promise<string> {
  // 起動ダウンロード中や loadResourceFile ハング中に Journal 保存・締めくくりを
  // ブロックしない。抽出は補助なので、未準備なら呼び出し元の catch に任せる。
  if (isLocalGeneratorBusyOrFailed()) {
    throw new Error("local chat model is not ready");
  }
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
