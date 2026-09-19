import { Hono } from "hono";
import { ensureLocalModels, getModelLoadSnapshot, retryFailedLocalModels } from "@emther/core/model-loader";

// docs/2nd_architecture/plan.md フェーズ2.5（高リスク バッチ7）: web/src/app/api/models/status/route.ts の移植。
// ローカルモデル（チャット／埋め込み）のキャッシュ確認・未取得時ダウンロード進捗。
// GET は状態を返すと同時に ensure を起動する（ブラウザが開いたタイミングで進めるため）。
// POST は失敗スロットの再試行用。
export const modelsStatusRoute = new Hono()
  .get("/", (c) => {
    void ensureLocalModels();
    return c.json(getModelLoadSnapshot());
  })
  .post("/", async (c) => {
    await retryFailedLocalModels();
    return c.json(getModelLoadSnapshot());
  });
