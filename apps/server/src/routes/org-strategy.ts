import { Hono } from "hono";
import type { OrgStrategyResponse } from "@emther/api-contract";
import { getOrgStrategy, type OrgStrategy, updateOrgStrategy } from "@emther/core/org-context-store/index";
import { unmaskNames } from "@emther/core/people-directory";
import type { StatementElaboration } from "@emther/core/types";

function toView(strategy: OrgStrategy): OrgStrategy {
  return {
    mission: unmaskNames(strategy.mission),
    vision: unmaskNames(strategy.vision),
    values: unmaskNames(strategy.values),
    ...(strategy.missionElaboration
      ? { missionElaboration: unmaskNames(strategy.missionElaboration) }
      : {}),
    ...(strategy.visionElaboration
      ? { visionElaboration: unmaskNames(strategy.visionElaboration) }
      : {}),
    ...(strategy.valueItems
      ? {
          valueItems: strategy.valueItems.map((v) => ({
            statement: unmaskNames(v.statement),
            ...(v.elaboration ? { elaboration: unmaskNames(v.elaboration) } : {}),
          })),
        }
      : {}),
  };
}

function parseValueItems(raw: unknown): StatementElaboration[] | null | undefined {
  if (raw === null) return null;
  if (!Array.isArray(raw)) return undefined;
  const items: StatementElaboration[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const statement = typeof (row as { statement?: unknown }).statement === "string"
      ? (row as { statement: string }).statement.trim()
      : "";
    if (!statement) continue;
    const elaborationRaw = (row as { elaboration?: unknown }).elaboration;
    const elaboration =
      typeof elaborationRaw === "string" && elaborationRaw.trim() ? elaborationRaw.trim() : undefined;
    items.push(elaboration ? { statement, elaboration } : { statement });
  }
  return items;
}

export const orgStrategyRoute = new Hono()
  .get("/", (c) => {
    const body = { strategy: toView(getOrgStrategy()) } satisfies OrgStrategyResponse;
    return c.json(body);
  })
  .patch("/", async (c) => {
    const body = await c.req.json().catch(() => null);
    const valueItems = parseValueItems(body?.valueItems);
    const strategy = await updateOrgStrategy({
      mission: typeof body?.mission === "string" ? body.mission : undefined,
      missionElaboration:
        body && "missionElaboration" in body
          ? typeof body.missionElaboration === "string"
            ? body.missionElaboration
            : null
          : undefined,
      vision: typeof body?.vision === "string" ? body.vision : undefined,
      visionElaboration:
        body && "visionElaboration" in body
          ? typeof body.visionElaboration === "string"
            ? body.visionElaboration
            : null
          : undefined,
      values: typeof body?.values === "string" ? body.values : undefined,
      valueItems,
    });
    const resBody = { strategy: toView(strategy) } satisfies OrgStrategyResponse;
    return c.json(resBody);
  });
