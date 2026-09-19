import { Hono } from "hono";
import { MASK_CHECK_MAX_INPUT_CHARS, runMaskCheckAi, runMaskCheckQuick } from "@emther/core/mask-check";

type Phase = "quick" | "ai";

// docs/2nd_architecture/plan.md フェーズ2.5（高リスク バッチ7）: web/src/app/api/mask-check/route.ts の移植。
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

  if (!body || typeof body !== "object") {
    return c.json({ error: "不正なリクエストです" }, 400);
  }

  const text = (body as { text?: unknown }).text;
  if (typeof text !== "string") {
    return c.json({ error: "text（文字列）が必要です" }, 400);
  }
  if (!text.trim()) {
    return c.json({ error: "テキストが空です" }, 400);
  }
  if (text.length > MASK_CHECK_MAX_INPUT_CHARS * 2) {
    // 極端な巨体は拒否（通常は上限で切り詰めて処理）
    return c.json({ error: `テキストが長すぎます（最大おおよそ ${MASK_CHECK_MAX_INPUT_CHARS} 文字）` }, 400);
  }

  const phaseRaw = (body as { phase?: unknown }).phase;
  const phase: Phase = phaseRaw === "ai" ? "ai" : "quick";

  if (phase === "quick") {
    return c.json({ phase: "quick", ...(await runMaskCheckQuick(text)) });
  }

  const ai = await runMaskCheckAi(text);
  return c.json({ phase: "ai", ...ai });
});
