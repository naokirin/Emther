import { Hono } from "hono";
import {
  teamsPostBodySchema,
  type OkResponse,
  type TeamMutationResponse,
  type TeamsBulkMutationResponse,
  type TeamsResponse,
} from "@emther/api-contract";
import {
  addTeam,
  getTeam,
  listTeams,
  removeTeam,
  setTeamArchived,
  toTeamView,
  updateTeam,
  type Team,
} from "@emther/core/org-context-store/index";
import { teamPathSegments } from "@emther/core/types";
import { unmaskNames } from "@emther/core/people-directory";

function toView(team: Team): Team {
  return { ...team, members: team.members.map(unmaskNames) };
}

type ParsedLine = { name: string; members: string[] };

// フォーマット: `チーム名: メンバー1, メンバー2`（":"は全角も可、メンバー区切りは","/"、"も可）
function parseBulkText(text: string): { parsed: ParsedLine[]; skipped: string[] } {
  const parsed: ParsedLine[] = [];
  const skipped: string[] = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const sepIndex = line.search(/[:：]/);
    if (sepIndex < 0) {
      skipped.push(line);
      continue;
    }
    const name = line.slice(0, sepIndex).trim();
    const membersPart = line.slice(sepIndex + 1).trim();
    if (teamPathSegments(name).length === 0) {
      skipped.push(line);
      continue;
    }
    const members = membersPart
      .split(/[,、]/)
      .map((m) => m.trim())
      .filter(Boolean);
    parsed.push({ name, members });
  }
  return { parsed, skipped };
}

export const teamsRoute = new Hono()
  .get("/", (c) => {
    const body = { teams: listTeams().map(toTeamView) } satisfies TeamsResponse;
    return c.json(body);
  })
  .post("/", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = teamsPostBodySchema.parse(body);
    const name = parsed.name ?? "";
    const members = parsed.members ?? [];

    // "/"のみ・空白のみなど、正規化すると空になる名前は「実質的にnameが無い」として拒否する
    // （階層区切りの"/"だけを入力してしまうミスを防ぐ）。
    if (teamPathSegments(name).length === 0) {
      return c.json({ error: "nameは必須です" }, 400);
    }

    const team = addTeam(name, members);
    const resBody = { team: toTeamView(team) } satisfies TeamMutationResponse;
    return c.json(resBody, 201);
  })
  .post("/bulk", async (c) => {
    const body = await c.req.json().catch(() => null);
    const text = typeof body?.text === "string" ? body.text : "";
    const { parsed, skipped } = parseBulkText(text);

    if (parsed.length === 0) {
      return c.json({ error: "有効な行がありません（`チーム名: メンバー1, メンバー2` の形式で1行ずつ入力してください）" }, 400);
    }

    const teams = parsed.map((p) => addTeam(p.name, p.members));
    const resBody = { teams: teams.map(toView), skipped } satisfies TeamsBulkMutationResponse;
    return c.json(resBody, 201);
  })
  .patch("/:id", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => null);
    const name = typeof body?.name === "string" ? body.name : undefined;
    if (name !== undefined && teamPathSegments(name).length === 0) {
      return c.json({ error: "nameは必須です" }, 400);
    }
    const team = await updateTeam(id, {
      name,
      members: Array.isArray(body?.members)
        ? body.members.filter((m: unknown): m is string => typeof m === "string")
        : undefined,
      mission: typeof body?.mission === "string" ? body.mission : undefined,
      constraints: typeof body?.constraints === "string" ? body.constraints : undefined,
      managedByEm: typeof body?.managedByEm === "boolean" ? body.managedByEm : undefined,
      aliases: Array.isArray(body?.aliases)
        ? body.aliases.filter((a: unknown): a is string => typeof a === "string")
        : undefined,
    });
    if (!team) {
      return c.json({ error: "not found" }, 404);
    }
    const resBody = { team: toTeamView(team) } satisfies TeamMutationResponse;
    return c.json(resBody);
  })
  .delete("/:id", (c) => {
    const removed = removeTeam(c.req.param("id"));
    if (!removed) {
      return c.json({ error: "not found" }, 404);
    }
    const resBody = { ok: true } satisfies OkResponse;
    return c.json(resBody);
  })
  .post("/:id/archive", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => null);
    const current = getTeam(id);
    if (!current) {
      return c.json({ error: "not found" }, 404);
    }
    const archived = typeof body?.archived === "boolean" ? body.archived : !current.archived;
    const team = setTeamArchived(id, archived);
    // setTeamArchivedはcurrentが存在する時点で常にTeamを返す想定だが、型上はundefinedを
    // 許容するため、TeamMutationResponse（nullable）に合わせてnullへ正規化する。
    const resBody = { team: team ? toView(team) : null } satisfies TeamMutationResponse;
    return c.json(resBody);
  });
