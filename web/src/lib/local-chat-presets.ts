// ローカルチャットモデルのプリセット定義。
// UI（クライアント）と推論（サーバー）の両方から参照するため、
// @huggingface/transformers 等の重い依存をここに置かない。
//
// 収録方針: Transformers.js でロード可能な ONNX（tokenizer.json 付き）のみ。
// Sarashina2.2 の onnx-community 版は tokenizer 欠落のため除外。

export const LOCAL_CHAT_MODEL_PRESET_IDS = ["350m", "0.5b", "1.2b", "1.2b-jp", "1.5b"] as const;
export type LocalChatModelPresetId = (typeof LOCAL_CHAT_MODEL_PRESET_IDS)[number];

export type LocalChatModelSpec = {
  task: "text-generation";
  id: string;
  dtype: "q4";
  /** 設定UI用の短い表示名 */
  label: string;
  /** 設定UI用の補足（メモリ目安など） */
  hint: string;
};

export const LOCAL_CHAT_MODEL_PRESETS: Record<LocalChatModelPresetId, LocalChatModelSpec> = {
  "350m": {
    task: "text-generation",
    id: "onnx-community/LFM2.5-350M-ONNX",
    dtype: "q4",
    label: "350M（LFM2.5・既定・省メモリ）",
    hint: "日本語を含む多言語向け。メモリ約8GB前後の環境向け。",
  },
  "0.5b": {
    task: "text-generation",
    id: "onnx-community/Qwen2.5-0.5B-Instruct",
    dtype: "q4",
    label: "0.5B（Qwen）",
    hint: "やや高精度。要約が中国語に寄りやすい場合あり。空きメモリに余裕がある環境向け。",
  },
  "1.2b": {
    task: "text-generation",
    id: "LiquidAI/LFM2.5-1.2B-Instruct-ONNX",
    dtype: "q4",
    label: "1.2B（LFM2.5・多言語）",
    hint: "350Mと同系列の大きめモデル。日本語を含む多言語向け。メモリに余裕がある環境向け。",
  },
  "1.2b-jp": {
    task: "text-generation",
    id: "LiquidAI/LFM2.5-1.2B-JP-202606-ONNX",
    dtype: "q4",
    label: "1.2B JP（LFM2.5・日本語特化）",
    hint: "日本語向けにチューニングされた1.2B。メモリに余裕がある環境向け。",
  },
  "1.5b": {
    task: "text-generation",
    id: "onnx-community/Qwen2.5-1.5B-Instruct",
    dtype: "q4",
    label: "1.5B（Qwen）",
    hint: "抽出精度は高いがメモリ消費が大きい（検証環境では不安定）。空きメモリに十分な余裕がある環境のみ。",
  },
};

/** 既定プリセット。 */
export const DEFAULT_LOCAL_CHAT_MODEL = LOCAL_CHAT_MODEL_PRESETS["350m"];

export function isLocalChatModelPresetId(value: unknown): value is LocalChatModelPresetId {
  return typeof value === "string" && (LOCAL_CHAT_MODEL_PRESET_IDS as readonly string[]).includes(value);
}
