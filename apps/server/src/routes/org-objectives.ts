import { Hono } from "hono";
import {
  addKeyResult,
  addObjective,
  importObjectives,
  removeKeyResult,
  removeObjective,
  toObjectiveView,
  updateKeyResult,
  updateObjective,
  type ObjectiveImportDraft,
} from "@emther/core/org-context-store/index";
import { listObjectivesWithProgress } from "@emther/core/objective-progress";

// docs/2nd_architecture/plan.md フェーズ2.5:
// web/src/app/api/org/objectives/{route,[id]/route,[id]/key-results/route,
// [id]/key-results/[krId]/route,import/route}.ts の移植。

function normalizeDrafts(raw: unknown): ObjectiveImportDraft[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const title = typeof (item as { title?: unknown }).title === "string" ? (item as { title: string }).title.trim() : "";
      if (!title) return null;
      const noteRaw = (item as { note?: unknown }).note;
      const note = typeof noteRaw === "string" && noteRaw.trim() ? noteRaw.trim() : undefined;
      const keyResults = Array.isArray((item as { keyResults?: unknown }).keyResults)
        ? ((item as { keyResults: unknown[] }).keyResults)
            .filter((t): t is string => typeof t === "string")
            .map((t) => t.trim())
            .filter(Boolean)
        : [];
      return { title, ...(note ? { note } : {}), keyResults } satisfies ObjectiveImportDraft;
    })
    .filter((d): d is ObjectiveImportDraft => !!d);
}

export const orgObjectivesRoute = new Hono()
  // docs/memo.md「H. 戦略→Issue→結果の一本線」対応。
  .get("/", (c) => c.json({ objectives: listObjectivesWithProgress().map(toObjectiveView) }))
  .post("/", async (c) => {
    const body = await c.req.json().catch(() => null);
    const title = typeof body?.title === "string" ? body.title.trim() : "";
    if (!title) {
      return c.json({ error: "titleは必須です" }, 400);
    }
    const teamId = typeof body?.teamId === "string" && body.teamId ? body.teamId : undefined;
    const note = typeof body?.note === "string" && body.note.trim() ? body.note.trim() : undefined;
    const objective = await addObjective(title, teamId, note);
    return c.json({ objective: toObjectiveView(objective) }, 201);
  })
  // docs/usage_issues U18: プレビュー済みドラフトを追記または同一スコープ差し替えで保存する。
  .post("/import", async (c) => {
    const body = await c.req.json().catch(() => null);
    const mode = body?.mode === "replace" ? "replace" : body?.mode === "append" ? "append" : null;
    if (!mode) {
      return c.json({ error: "modeは append または replace です" }, 400);
    }
    const drafts = normalizeDrafts(body?.objectives);
    if (drafts.length === 0) {
      return c.json({ error: "objectives（title付き）が1件以上必要です" }, 400);
    }
    const teamId = typeof body?.teamId === "string" && body.teamId ? body.teamId : undefined;
    const created = await importObjectives(drafts, { mode, teamId });
    return c.json({ objectives: created.map(toObjectiveView) }, 201);
  })
  .patch("/:id", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => null);
    const hasTitle = typeof body?.title === "string";
    const hasTeamId = !!body && "teamId" in body;
    const hasNote = !!body && "note" in body;
    if (!hasTitle && !hasTeamId && !hasNote) {
      return c.json({ error: "title・teamId・noteのいずれかが必要です" }, 400);
    }
    const title = hasTitle ? body.title : undefined;
    // teamId: 未指定キー＝変更しない、null／空文字＝組織全体の目標に戻す、文字列＝そのチームの目標にする。
    const teamId = hasTeamId ? (typeof body.teamId === "string" && body.teamId ? body.teamId : null) : undefined;
    // note: 未指定キー＝変更しない、null／空文字＝クリア、文字列＝設定。
    const note = hasNote ? (typeof body.note === "string" ? body.note : null) : undefined;
    const objective = await updateObjective(id, { title, teamId, note });
    if (!objective) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json({ objective: toObjectiveView(objective) });
  })
  .delete("/:id", (c) => {
    const removed = removeObjective(c.req.param("id"));
    if (!removed) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json({ ok: true });
  })
  .post("/:id/key-results", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => null);
    const title = typeof body?.title === "string" ? body.title.trim() : "";
    if (!title) {
      return c.json({ error: "titleは必須です" }, 400);
    }
    const objective = await addKeyResult(id, title);
    if (!objective) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json({ objective: toObjectiveView(objective) }, 201);
  })
  .patch("/:id/key-results/:krId", async (c) => {
    const { id, krId } = c.req.param();
    const body = await c.req.json().catch(() => null);
    const title = typeof body?.title === "string" ? body.title.trim() : "";
    if (!title) {
      return c.json({ error: "titleは必須です" }, 400);
    }
    const objective = await updateKeyResult(id, krId, title);
    if (!objective) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json({ objective: toObjectiveView(objective) });
  })
  .delete("/:id/key-results/:krId", (c) => {
    const { id, krId } = c.req.param();
    const objective = removeKeyResult(id, krId);
    if (!objective) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json({ objective: toObjectiveView(objective) });
  });
