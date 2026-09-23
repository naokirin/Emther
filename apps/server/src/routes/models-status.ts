import { Hono } from "hono";
import type { ModelsStatusResponse } from "@emther/api-contract";
import { ensureLocalModels, getModelLoadSnapshot, retryFailedLocalModels } from "@emther/core/model-loader";

// docs/2nd_architecture/plan.md フェーズ2.5（高リスク バッチ7）: web/src/app/api/models/status/route.ts の移植。
// ローカルモデル（チャット／埋め込み）のキャッシュ確認・未取得時ダウンロード進捗。
// GET は状態を返すと同時に ensure を起動する（ブラウザが開いたタイミングで進めるため）。
// POST は失敗スロットの再試行用。
export const modelsStatusRoute = new Hono()
  .get("/", (c) => {
    void ensureLocalModels();
    const body = getModelLoadSnapshot() satisfies ModelsStatusResponse;
    return c.json(body);
  })
  .post("/", async (c) => {
    await retryFailedLocalModels();
    const body = getModelLoadSnapshot() satisfies ModelsStatusResponse;
    return c.json(body);
  });
