import { Hono } from "hono";
import type { PoliciesResponse } from "@emther/api-contract";
import {
  addPolicy,
  listPolicies,
  removePolicy,
  toPolicyView,
  updatePolicy,
  type PolicyCategory,
} from "@emther/core/org-context-store/index";

function parseCategory(value: unknown): PolicyCategory | undefined {
  return value === "value" || value === "priority" || value === "avoid" || value === "principle" || value === "other"
    ? value
    : undefined;
}

// docs/goal_policy_model_plan.md Phase 1。web/src/app/api/org/background/{route,[id]/route}.ts と
// 同じ構成のPolicy版。
export const orgPoliciesRoute = new Hono()
  .get("/", (c) => {
    const body = { policies: listPolicies().map(toPolicyView) } satisfies PoliciesResponse;
    return c.json(body);
  })
  .post("/", async (c) => {
    const body = await c.req.json().catch(() => null);
    const text = typeof body?.text === "string" ? body.text.trim() : "";
    if (!text) {
      return c.json({ error: "textは必須です" }, 400);
    }
    const category = parseCategory(body?.category);
    const elaboration =
      typeof body?.elaboration === "string" && body.elaboration.trim() ? body.elaboration.trim() : undefined;

    try {
      const entry = await addPolicy({ text, category, elaboration });
      return c.json({ policy: toPolicyView(entry) }, 201);
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
      text?: string;
      elaboration?: string | null;
      category?: PolicyCategory | null;
      archivedAt?: number | null;
    } = {};

    if ("text" in body && typeof body.text === "string") patch.text = body.text;
    if ("elaboration" in body) {
      patch.elaboration = typeof body.elaboration === "string" ? body.elaboration : null;
    }
    if ("category" in body) {
      patch.category = body.category === null ? null : parseCategory(body.category) ?? null;
    }
    if ("archived" in body) {
      patch.archivedAt = body.archived ? Date.now() : null;
    }

    if (Object.keys(patch).length === 0) {
      return c.json({ error: "更新フィールドがありません" }, 400);
    }

    const entry = await updatePolicy(id, patch);
    if (!entry) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json({ policy: toPolicyView(entry) });
  })
  .delete("/:id", (c) => {
    const removed = removePolicy(c.req.param("id"));
    if (!removed) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json({ ok: true });
  });
