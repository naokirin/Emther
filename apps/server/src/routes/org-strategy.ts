import { Hono } from "hono";
import { getOrgStrategy, type OrgStrategy, updateOrgStrategy } from "@emther/core/org-context-store/index";
import { unmaskNames } from "@emther/core/people-directory";

// docs/2nd_architecture/plan.md フェーズ2.5: web/src/app/api/org/strategy/route.ts の移植。
// 個人情報の分離（ユーザー指摘対応）: ストア側はPERSON_n IDでマスクされたテキストを
// 保持している。EM向けの応答を組み立てるこの境界でだけ実名へ復元する。
function toView(strategy: OrgStrategy): OrgStrategy {
  return {
    mission: unmaskNames(strategy.mission),
    vision: unmaskNames(strategy.vision),
    values: unmaskNames(strategy.values),
  };
}

export const orgStrategyRoute = new Hono()
  .get("/", (c) => c.json({ strategy: toView(getOrgStrategy()) }))
  .patch("/", async (c) => {
    const body = await c.req.json().catch(() => null);
    const strategy = await updateOrgStrategy({
      mission: typeof body?.mission === "string" ? body.mission : undefined,
      vision: typeof body?.vision === "string" ? body.vision : undefined,
      values: typeof body?.values === "string" ? body.values : undefined,
    });
    return c.json({ strategy: toView(strategy) });
  });
