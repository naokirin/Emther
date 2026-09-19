import { Hono } from "hono";
import { startGrowAnalysis, toRunView } from "@emther/core/agent-runtime/index";
import { isUnconfirmedNameCandidatesError } from "@emther/core/name-candidate-confirmation";

// docs/2nd_architecture/plan.md フェーズ2.5（高リスク バッチ5）: web/src/app/api/growth/generate/route.ts の移植。
// docs/2nd_pivot_version.md Phase 8。/api/themes/distillと同型のオンデマンド起動。
export const growthGenerateRoute = new Hono().post("/", async (c) => {
  try {
    const run = await startGrowAnalysis({ manual: true });
    if (!run) {
      return c.json({ pendingUnmasked: true }, 202);
    }
    return c.json({ run: toRunView(run) }, 201);
  } catch (err) {
    if (isUnconfirmedNameCandidatesError(err)) {
      return c.json({ error: err.message, candidates: err.candidates }, 409);
    }
    return c.json({ error: (err as Error).message }, 500);
  }
});
