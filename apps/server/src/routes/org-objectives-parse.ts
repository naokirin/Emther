import { Hono } from "hono";
import { parseOkrText } from "@emther/core/okr-parse";
import { jsonFromUnknownError, maskOptionsFromBody } from "../lib/name-candidate-response";

// docs/2nd_architecture/plan.md フェーズ2.5（高リスク バッチ10）: web/src/app/api/org/objectives/parse/route.ts の移植。
// docs/usage_issues U18: OKR全文を構造化してプレビュー用ドラフトを返す（保存はしない）。
// 外部AI（SettingsのCLI優先順）で分解し、失敗時はヒューリスティックへフォールバックする。
export const orgObjectivesParseRoute = new Hono().post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  const text = typeof body?.text === "string" ? body.text : "";
  if (!text.trim()) {
    return c.json({ error: "textは必須です" }, 400);
  }
  try {
    const result = await parseOkrText(text, maskOptionsFromBody(body));
    return c.json(result);
  } catch (err) {
    return jsonFromUnknownError(err);
  }
});
