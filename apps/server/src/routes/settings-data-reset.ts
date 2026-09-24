import { Hono } from "hono";
import type { DataMutationResponse } from "@emther/api-contract";
import { resetAllState, scheduleProcessExit } from "@emther/core/state-archive";

// 単一プロセス配信では scheduleProcessExit()（process.exit）がアプリ全体終了になるため問題ない。
// （並走時代は Hono だけ落ちてプロキシ先が壊れるため未導入だった。）
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
