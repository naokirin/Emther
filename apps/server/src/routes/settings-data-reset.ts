import { Hono } from "hono";
import type { DataMutationResponse } from "@emther/api-contract";
import { resetAllState, scheduleProcessExit } from "@emther/core/state-archive";

// docs/2nd_architecture/plan.md フェーズ4.3a: web/src/app/api/settings/data/reset/route.ts
// から移植。フェーズ2〜3の並走期間は scheduleProcessExit()（呼び出し元プロセスの
// process.exit）が「Honoプロセスだけを落とし、Next側はプロキシ先が死んだ壊れた
// 状態のまま残る」ためあえて未移植だった（dev-hybrid-rules.md 5節参照）。
// フェーズ4.3で単一プロセス配信に切り替わったため、プロセス終了＝アプリ全体の
// 終了となり問題が解消したので移植する。
export const settingsDataResetRoute = new Hono().post("/", async (c) => {
  try {
    const body = await c.req.json().catch(() => null);
    if (body?.confirm !== "RESET") {
      return c.json({ error: '確認のため body に { "confirm": "RESET" } が必要です' }, 400);
    }
    resetAllState();
    scheduleProcessExit();
    const resBody = { ok: true, requiresRestart: true } satisfies DataMutationResponse;
    return c.json(resBody);
  } catch (err) {
    return c.json({ error: (err as Error).message || "リセットに失敗しました" }, 500);
  }
});
