import { Hono } from "hono";
import type { ThemeMutationResponse, ThemesFromGoalResponse, ThemesResponse } from "@emther/api-contract";
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
import { listGoals } from "@emther/core/org-context-store/index";

// docs/2nd_architecture/plan.md フェーズ2.5:
// web/src/app/api/themes/{route,[id]/route}.ts の移植。

function stringIdList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((id): id is string => typeof id === "string");
}

export const themesRoute = new Hono()
  .get("/", (c) => {
    const status = c.req.query("status") as ThemeStatus | undefined;
    const body = {
      themes: listCurrentThemes(status ? { status } : undefined).map(toThemeView),
    } satisfies ThemesResponse;
    return c.json(body);
  })
  .post("/", async (c) => {
    const body = await c.req.json().catch(() => null);
    const title = typeof body?.title === "string" ? body.title.trim() : "";
    const summary = typeof body?.summary === "string" ? body.summary.trim() : "";
    const rationale = typeof body?.rationale === "string" ? body.rationale.trim() : "";

    if (!title) {
      return c.json({ error: "title は必須です" }, 400);
    }

    const theme = await createTheme({
      title,
      summary,
      rationale: rationale || summary || title,
      facts: Array.isArray(body?.facts) ? body.facts : [],
      teamId: typeof body?.teamId === "string" ? body.teamId : undefined,
      status: body?.status === "candidate" ? "candidate" : "adopted",
    });

    const resBody = { theme: toThemeView(theme) } satisfies ThemeMutationResponse;
    return c.json(resBody, 201);
  })
  // docs/goal_policy_model_plan.md Decision 3 / Phase 3。Goal起点で先にテーマ候補を置く経路。
  // ヒューリスティック（AIなし）。人間が採用するまでcandidate。
  .post("/from-goal", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { goalIds?: string[] };
    const all = listGoals().filter((g) => g.status === "active");
    const filterIds = Array.isArray(body.goalIds)
      ? new Set(body.goalIds.filter((id): id is string => typeof id === "string" && !!id))
      : null;
    const goals = filterIds ? all.filter((g) => filterIds.has(g.id)) : all;

    if (goals.length === 0) {
      return c.json({ error: "対象の Goal がありません" }, 400);
    }

    const themes = [];
    for (const goal of goals) {
      const theme = await createThemeCandidate({
        title: goal.title,
        summary: `Goal「${goal.title}」を今期の焦点として解くためのテーマ候補`,
        rationale: "Goal起点で自動生成した候補。観測差分による週次蒸留で修正する前提。",
        facts: [`Goal: ${goal.title}`, ...(goal.note ? [`補足: ${goal.note}`] : [])],
        suggestedDirection: `Goal「${goal.title}」の達成に効く組織課題を優先する`,
        goalIds: [goal.id],
        teamId: goal.teamId,
      });
      themes.push(toThemeView(theme));
    }

    const resBody = { themes } satisfies ThemesFromGoalResponse;
    return c.json(resBody, 201);
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
      const resBody = { theme: toThemeView(theme) } satisfies ThemeMutationResponse;
      return c.json(resBody);
    }
    if (action === "dismiss") {
      const theme = dismissTheme(id);
      if (!theme) return c.json({ error: "not found" }, 404);
      const resBody = { theme: toThemeView(theme) } satisfies ThemeMutationResponse;
      return c.json(resBody);
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
      const resBody = { theme: toThemeView(theme) } satisfies ThemeMutationResponse;
      return c.json(resBody);
    }
    if (action === "link" || (!action && "goalIds" in (body ?? {}))) {
      const theme = updateThemeLinks(id, {
        goalIds: body?.goalIds === null ? null : stringIdList(body?.goalIds),
        teamId: body?.teamId === null ? null : typeof body?.teamId === "string" ? body.teamId : undefined,
      });
      if (!theme) return c.json({ error: "not found" }, 404);
      const resBody = { theme: toThemeView(theme) } satisfies ThemeMutationResponse;
      return c.json(resBody);
    }

    return c.json({ error: "action は adopt / dismiss / revise / link のいずれかです" }, 400);
  });
