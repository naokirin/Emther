import { Hono } from "hono";
import type { OrgBackgroundsResponse } from "@emther/api-contract";
import {
  addOrgBackground,
  listOrgBackgrounds,
  removeOrgBackground,
  toOrgBackgroundView,
  updateOrgBackground,
  type OrgBackgroundScope,
  type OrgBackgroundStatus,
} from "@emther/core/org-context-store/index";

// docs/2nd_architecture/plan.md フェーズ2.5: web/src/app/api/org/background/{route,[id]/route}.ts の移植。
export const orgBackgroundRoute = new Hono()
  .get("/", (c) => {
    const body = { backgrounds: listOrgBackgrounds().map(toOrgBackgroundView) } satisfies OrgBackgroundsResponse;
    return c.json(body);
  })
  .post("/", async (c) => {
    const body = await c.req.json().catch(() => null);
    const title = typeof body?.title === "string" ? body.title.trim() : "";
    const fact = typeof body?.fact === "string" ? body.fact.trim() : "";
    if (!title || !fact) {
      return c.json({ error: "titleとfactは必須です" }, 400);
    }
    const implication = typeof body?.implication === "string" ? body.implication : undefined;
    const occurredOn = typeof body?.occurredOn === "string" ? body.occurredOn : undefined;
    const tags = Array.isArray(body?.tags)
      ? body.tags.filter((t: unknown): t is string => typeof t === "string")
      : undefined;
    const scope: OrgBackgroundScope | undefined =
      body?.scope === "always" || body?.scope === "tagged" ? body.scope : undefined;
    const status: OrgBackgroundStatus | undefined =
      body?.status === "active" || body?.status === "archived" ? body.status : undefined;

    try {
      const entry = await addOrgBackground({
        title,
        fact,
        implication,
        occurredOn,
        tags,
        scope,
        status,
      });
      return c.json({ background: toOrgBackgroundView(entry) }, 201);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  })
  .patch("/:id", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return c.json({ error: "bodyが必要です" }, 400);
    }

    const patch: {
      title?: string;
      fact?: string;
      implication?: string | null;
      occurredOn?: string | null;
      tags?: string[];
      scope?: OrgBackgroundScope;
      status?: OrgBackgroundStatus;
    } = {};

    if ("title" in body && typeof body.title === "string") patch.title = body.title;
    if ("fact" in body && typeof body.fact === "string") patch.fact = body.fact;
    if ("implication" in body) {
      patch.implication = typeof body.implication === "string" ? body.implication : null;
    }
    if ("occurredOn" in body) {
      patch.occurredOn = typeof body.occurredOn === "string" ? body.occurredOn : null;
    }
    if ("tags" in body) {
      if (!Array.isArray(body.tags)) {
        return c.json({ error: "tagsは配列である必要があります" }, 400);
      }
      patch.tags = body.tags.filter((t: unknown): t is string => typeof t === "string");
    }
    if ("scope" in body) {
      if (body.scope !== "always" && body.scope !== "tagged") {
        return c.json({ error: "scopeは always または tagged です" }, 400);
      }
      patch.scope = body.scope;
    }
    if ("status" in body) {
      if (body.status !== "active" && body.status !== "archived") {
        return c.json({ error: "statusは active または archived です" }, 400);
      }
      patch.status = body.status;
    }

    if (Object.keys(patch).length === 0) {
      return c.json({ error: "更新フィールドがありません" }, 400);
    }

    const entry = await updateOrgBackground(id, patch);
    if (!entry) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json({ background: toOrgBackgroundView(entry) });
  })
  .delete("/:id", (c) => {
    const removed = removeOrgBackground(c.req.param("id"));
    if (!removed) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json({ ok: true });
  });
