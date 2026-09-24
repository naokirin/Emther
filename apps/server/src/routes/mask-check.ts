import { Hono } from "hono";
import { maskCheckPostBodySchema, type MaskCheckResponse } from "@emther/api-contract";
import { MASK_CHECK_MAX_INPUT_CHARS, runMaskCheckAi, runMaskCheckQuick } from "@emther/core/mask-check";

/**
 * 個人・機密情報チェック。
 * body: { text: string, phase?: "quick" | "ai" }
 * - quick: 登録済み人名マスク + ルール検知（即時）
 * - ai: ローカル AI の機微候補 + 未登録人名っぽい語句（常時実行想定・やや遅い）
 * いずれも永続化・人名登録・外部送信なし。
 */
export const maskCheckRoute = new Hono().post("/", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "JSONボディが必要です" }, 400);
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return c.json({ error: "不正なリクエストです" }, 400);
  }

  const parsed = maskCheckPostBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "text（文字列）が必要です" }, 400);
  }

  const text = parsed.data.text;
  if (!text.trim()) {
    return c.json({ error: "テキストが空です" }, 400);
  }
  if (text.length > MASK_CHECK_MAX_INPUT_CHARS * 2) {
    // 極端な巨体は拒否（通常は上限で切り詰めて処理）
    return c.json({ error: `テキストが長すぎます（最大おおよそ ${MASK_CHECK_MAX_INPUT_CHARS} 文字）` }, 400);
  }

  const phase = parsed.data.phase === "ai" ? "ai" : "quick";

  if (phase === "quick") {
    const resBody = { phase: "quick" as const, ...(await runMaskCheckQuick(text)) } satisfies MaskCheckResponse;
    return c.json(resBody);
  }

  const ai = await runMaskCheckAi(text);
  const resBody = { phase: "ai" as const, ...ai } satisfies MaskCheckResponse;
  return c.json(resBody);
});
