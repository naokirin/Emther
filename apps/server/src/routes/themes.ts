import { Hono } from "hono";
import {
  adoptTheme,
  createTheme,
  createThemeCandidate,
  dismissTheme,
  getTheme,
  listCurrentThemes,
  reviseTheme,
  toThemeView,
  updateThemeLinks,
  type ThemeStatus,
} from "@emther/core/theme-store";
import { listObjectives } from "@emther/core/org-context-store/index";

// docs/2nd_architecture/plan.md フェーズ2.5:
// web/src/app/api/themes/{route,[id]/route,from-okr/route}.ts の移植。

function stringIdList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((id): id is string => typeof id === "string");
}

export const themesRoute = new Hono()
  .get("/", (c) => {
    const status = c.req.query("status") as ThemeStatus | undefined;
    const themes = listCurrentThemes(status ? { status } : undefined).map(toThemeView);
    return c.json({ themes });
  })
  .post("/", async (c) => {
    const body = await c.req.json().catch(() => null);
    const title = typeof body?.title === "string" ? body.title.trim() : "";
    const summary = typeof body?.summary === "string" ? body.summary.trim() : "";
    const rationale = typeof body?.rationale === "string" ? body.rationale.trim() : "";

    if (!title || !summary) {
      return c.json({ error: "title と summary は必須です" }, 400);
    }

    const theme = await createTheme({
      title,
      summary,
      rationale: rationale || summary,
      facts: Array.isArray(body?.facts) ? body.facts : [],
      objectiveIds: Array.isArray(body?.objectiveIds) ? body.objectiveIds : [],
      keyResultIds: Array.isArray(body?.keyResultIds) ? body.keyResultIds : [],
      teamId: typeof body?.teamId === "string" ? body.teamId : undefined,
      status: body?.status === "candidate" ? "candidate" : "adopted",
    });

    return c.json({ theme: toThemeView(theme) }, 201);
  })
  // docs/value_hierarchy_and_flow.md §2.3。期初・OKR 更新時に Objective/KR から候補テーマを先に置く。
  // 初回はヒューリスティック（AI なし）。人間が採用するまで candidate。
  .post("/from-okr", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { objectiveIds?: string[]; perKeyResult?: boolean };
    const all = listObjectives();
    const filterIds = Array.isArray(body.objectiveIds)
      ? new Set(body.objectiveIds.filter((id): id is string => typeof id === "string" && !!id))
      : null;
    const objectives = filterIds ? all.filter((o) => filterIds.has(o.id)) : all;

    if (objectives.length === 0) {
      return c.json({ error: "対象の Objective がありません" }, 400);
    }

    const themes = [];
    for (const objective of objectives) {
      if (body.perKeyResult && objective.keyResults.length > 0) {
        for (const kr of objective.keyResults) {
          const theme = await createThemeCandidate({
            title: `${objective.title} / ${kr.title}`,
            summary: `Key Result「${kr.title}」に向けた今期の焦点候補（Objective: ${objective.title}）`,
            rationale: "OKR 起点で自動生成した候補。観測差分による週次蒸留で修正する前提。",
            facts: [`Objective: ${objective.title}`, `Key Result: ${kr.title}`],
            suggestedDirection: `「${kr.title}」の達成を阻む組織・プロセス上の詰まりを特定し介入する`,
            objectiveIds: [objective.id],
            keyResultIds: [kr.id],
            teamId: objective.teamId,
          });
          themes.push(toThemeView(theme));
        }
        continue;
      }

      const krLines = objective.keyResults.map((kr) => kr.title);
      const theme = await createThemeCandidate({
        title: objective.title,
        summary: `Objective「${objective.title}」を今期の焦点として解くためのテーマ候補`,
        rationale: "OKR 起点で自動生成した候補。観測差分による週次蒸留で修正する前提。",
        facts: [
          `Objective: ${objective.title}`,
          ...(objective.note ? [`補足: ${objective.note}`] : []),
          ...krLines.map((t) => `KR: ${t}`),
        ],
        suggestedDirection:
          krLines.length > 0
            ? `Key Result（${krLines.join(" / ")}）の達成に効く組織課題を優先する`
            : `Objective「${objective.title}」の達成に効く組織課題を優先する`,
        objectiveIds: [objective.id],
        keyResultIds: objective.keyResults.map((kr) => kr.id),
        teamId: objective.teamId,
      });
      themes.push(toThemeView(theme));
    }

    return c.json({ themes }, 201);
  })
  .get("/:id", (c) => {
    const theme = getTheme(c.req.param("id"));
    if (!theme) return c.json({ error: "not found" }, 404);
    return c.json({ theme: toThemeView(theme) });
  })
  .patch("/:id", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => null);
    const action = typeof body?.action === "string" ? body.action : "";

    if (action === "adopt") {
      const theme = await adoptTheme(id);
      if (!theme) return c.json({ error: "not found" }, 404);
      return c.json({ theme: toThemeView(theme) });
    }
    if (action === "dismiss") {
      const theme = dismissTheme(id);
      if (!theme) return c.json({ error: "not found" }, 404);
      return c.json({ theme: toThemeView(theme) });
    }
    if (action === "revise") {
      const theme = await reviseTheme(id, {
        title: typeof body?.title === "string" ? body.title : undefined,
        summary: typeof body?.summary === "string" ? body.summary : undefined,
        rationale: typeof body?.rationale === "string" ? body.rationale : undefined,
        facts: Array.isArray(body?.facts) ? body.facts.filter((f: unknown): f is string => typeof f === "string") : undefined,
        rootCause: body?.rootCause === null ? null : typeof body?.rootCause === "string" ? body.rootCause : undefined,
        suggestedDirection:
          body?.suggestedDirection === null
            ? null
            : typeof body?.suggestedDirection === "string"
              ? body.suggestedDirection
              : undefined,
      });
      if (!theme) return c.json({ error: "not found" }, 404);
      return c.json({ theme: toThemeView(theme) });
    }
    if (action === "link" || (!action && ("objectiveIds" in (body ?? {}) || "keyResultIds" in (body ?? {})))) {
      const theme = updateThemeLinks(id, {
        objectiveIds: body?.objectiveIds === null ? null : stringIdList(body?.objectiveIds),
        keyResultIds: body?.keyResultIds === null ? null : stringIdList(body?.keyResultIds),
        teamId: body?.teamId === null ? null : typeof body?.teamId === "string" ? body.teamId : undefined,
      });
      if (!theme) return c.json({ error: "not found" }, 404);
      return c.json({ theme: toThemeView(theme) });
    }

    return c.json({ error: "action は adopt / dismiss / revise / link のいずれかです" }, 400);
  });
