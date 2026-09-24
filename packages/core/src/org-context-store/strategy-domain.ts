import { maskForStorage } from "../people-directory";
import type { StatementElaboration } from "../types";
import type { OrgStrategyRepository } from "./strategy-repository";
import {
  DEFAULT_STRATEGY,
  type OrgStrategy,
  type OrgStrategyPatch,
} from "./strategy-types";

function splitLegacyValues(values: string): StatementElaboration[] {
  return values
    .split(/[\n,、]/)
    .map((v) => v.trim())
    .filter(Boolean)
    .map((statement) => ({ statement }));
}

function joinValueStatements(items: StatementElaboration[]): string {
  return items.map((v) => v.statement.trim()).filter(Boolean).join("\n");
}

function normalizeLoaded(raw: Partial<OrgStrategy>): OrgStrategy {
  const mission = typeof raw.mission === "string" ? raw.mission : "";
  const vision = typeof raw.vision === "string" ? raw.vision : "";
  const values = typeof raw.values === "string" ? raw.values : "";
  const missionElaboration =
    typeof raw.missionElaboration === "string" && raw.missionElaboration.trim()
      ? raw.missionElaboration
      : undefined;
  const visionElaboration =
    typeof raw.visionElaboration === "string" && raw.visionElaboration.trim()
      ? raw.visionElaboration
      : undefined;

  let valueItems: StatementElaboration[] | undefined;
  if (Array.isArray(raw.valueItems)) {
    valueItems = raw.valueItems
      .filter((v): v is StatementElaboration => !!v && typeof v.statement === "string")
      .map((v) => ({
        statement: v.statement.trim(),
        ...(typeof v.elaboration === "string" && v.elaboration.trim()
          ? { elaboration: v.elaboration.trim() }
          : {}),
      }))
      .filter((v) => v.statement);
    if (valueItems.length === 0) valueItems = undefined;
  } else if (values.trim()) {
    valueItems = splitLegacyValues(values);
  }

  return {
    mission,
    vision,
    values: valueItems ? joinValueStatements(valueItems) : values,
    ...(missionElaboration ? { missionElaboration } : {}),
    ...(visionElaboration ? { visionElaboration } : {}),
    ...(valueItems ? { valueItems } : {}),
  };
}

async function maskOptionalText(value: string | null | undefined): Promise<string | undefined> {
  if (value === null || value === undefined) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return maskForStorage(trimmed);
}

export function createOrgStrategyService(repo: OrgStrategyRepository) {
  let strategy: OrgStrategy = normalizeLoaded({
    ...DEFAULT_STRATEGY,
    ...repo.load(),
  });

  function persistStrategy(): void {
    repo.save(strategy);
  }

  function getOrgStrategy(): OrgStrategy {
    return strategy;
  }

  async function updateOrgStrategy(patch: OrgStrategyPatch): Promise<OrgStrategy> {
    const next: OrgStrategy = { ...strategy };

    if (patch.mission !== undefined) {
      next.mission = await maskForStorage(patch.mission.trim());
    }
    if (patch.missionElaboration !== undefined) {
      const elab = await maskOptionalText(patch.missionElaboration);
      if (elab) next.missionElaboration = elab;
      else delete next.missionElaboration;
    }
    if (patch.vision !== undefined) {
      next.vision = await maskForStorage(patch.vision.trim());
    }
    if (patch.visionElaboration !== undefined) {
      const elab = await maskOptionalText(patch.visionElaboration);
      if (elab) next.visionElaboration = elab;
      else delete next.visionElaboration;
    }

    if (patch.valueItems !== undefined) {
      if (patch.valueItems === null || patch.valueItems.length === 0) {
        delete next.valueItems;
        next.values = "";
      } else {
        const items: StatementElaboration[] = [];
        for (const item of patch.valueItems) {
          const statement = (await maskForStorage(item.statement.trim())).trim();
          if (!statement) continue;
          const elaboration = item.elaboration ? await maskOptionalText(item.elaboration) : undefined;
          items.push(elaboration ? { statement, elaboration } : { statement });
        }
        if (items.length === 0) {
          delete next.valueItems;
          next.values = "";
        } else {
          next.valueItems = items;
          next.values = joinValueStatements(items);
        }
      }
    } else if (patch.values !== undefined) {
      next.values = await maskForStorage(patch.values.trim());
      const items = splitLegacyValues(next.values);
      if (items.length > 0) next.valueItems = items;
      else delete next.valueItems;
    }

    strategy = next;
    persistStrategy();
    return strategy;
  }

  return { getOrgStrategy, updateOrgStrategy };
}
