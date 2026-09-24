import { Hono } from "hono";
import type { GoalMutationResponse, GoalsResponse, OkResponse } from "@emther/api-contract";
import { addGoal, listGoals, removeGoal, toGoalView, updateGoal, type GoalHorizon, type GoalStatus } from "@emther/core/org-context-store/index";

function parseHorizon(value: unknown): GoalHorizon | undefined {
  return value === "long" || value === "mid" || value === "near" ? value : undefined;
}

function parseStatus(value: unknown): GoalStatus | undefined {
  return value === "active" || value === "achieved" || value === "abandoned" ? value : undefined;
}

// Policy ルートと同型の Goal CRUD。
export const goalsRoute = new Hono()
  .get("/", (c) => {
    const body = { goals: listGoals().map(toGoalView) } satisfies GoalsResponse;
    return c.json(body);
  })
  .post("/", async (c) => {
    const body = await c.req.json().catch(() => null);
    const title = typeof body?.title === "string" ? body.title.trim() : "";
    if (!title) {
      return c.json({ error: "titleは必須です" }, 400);
    }
    const teamId = typeof body?.teamId === "string" && body.teamId ? body.teamId : undefined;
    const elaboration =
      typeof body?.elaboration === "string" && body.elaboration.trim() ? body.elaboration.trim() : undefined;
    const note = typeof body?.note === "string" && body.note.trim() ? body.note.trim() : undefined;
    const horizon = parseHorizon(body?.horizon);

    try {
      const goal = await addGoal({ title, teamId, elaboration, note, horizon });
      const resBody = { goal: toGoalView(goal) } satisfies GoalMutationResponse;
      return c.json(resBody, 201);
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
      teamId?: string | null;
      elaboration?: string | null;
      note?: string | null;
      horizon?: GoalHorizon | null;
      status?: GoalStatus;
    } = {};

    if ("title" in body && typeof body.title === "string") patch.title = body.title;
    if ("teamId" in body) {
      patch.teamId = typeof body.teamId === "string" && body.teamId ? body.teamId : null;
    }
    if ("elaboration" in body) {
      patch.elaboration = typeof body.elaboration === "string" ? body.elaboration : null;
    }
    if ("note" in body) {
      patch.note = typeof body.note === "string" ? body.note : null;
    }
    if ("horizon" in body) {
      patch.horizon = body.horizon === null ? null : parseHorizon(body.horizon) ?? null;
    }
    if ("status" in body) {
      const status = parseStatus(body.status);
      if (!status) return c.json({ error: "statusは active / achieved / abandoned のいずれかです" }, 400);
      patch.status = status;
    }

    if (Object.keys(patch).length === 0) {
      return c.json({ error: "更新フィールドがありません" }, 400);
    }

    const goal = await updateGoal(id, patch);
    if (!goal) {
      return c.json({ error: "not found" }, 404);
    }
    const resBody = { goal: toGoalView(goal) } satisfies GoalMutationResponse;
    return c.json(resBody);
  })
  .delete("/:id", (c) => {
    const removed = removeGoal(c.req.param("id"));
    if (!removed) {
      return c.json({ error: "not found" }, 404);
    }
    const resBody = { ok: true } satisfies OkResponse;
    return c.json(resBody);
  });
