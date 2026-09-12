import { randomUUID } from "node:crypto";
import { loadJSON, saveJSON } from "@/lib/persistence";
import {
  parseImportMappingConfig,
  type ImportMappingConfig,
  type ImportProfile,
} from "@/lib/observation-dump-mapping-types";

const FILE = "observation-import-profiles.json";

const profiles: ImportProfile[] = loadJSON<ImportProfile[]>(FILE, []);

function persist(): void {
  saveJSON(FILE, profiles);
}

export function listImportProfiles(): ImportProfile[] {
  return [...profiles].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getImportProfile(id: string): ImportProfile | undefined {
  return profiles.find((p) => p.id === id);
}

export function saveImportProfile(input: {
  id?: string;
  name: string;
  config: ImportMappingConfig;
}): ImportProfile {
  const name = input.name.trim();
  if (!name) throw new Error("プロファイル名は必須です");
  const now = Date.now();
  if (input.id) {
    const idx = profiles.findIndex((p) => p.id === input.id);
    if (idx < 0) throw new Error("プロファイルが見つかりません");
    const next: ImportProfile = {
      ...profiles[idx],
      name,
      config: input.config,
      updatedAt: now,
    };
    profiles[idx] = next;
    persist();
    return next;
  }
  const profile: ImportProfile = {
    id: randomUUID(),
    name,
    config: input.config,
    createdAt: now,
    updatedAt: now,
  };
  profiles.unshift(profile);
  persist();
  return profile;
}

export function deleteImportProfile(id: string): boolean {
  const idx = profiles.findIndex((p) => p.id === id);
  if (idx < 0) return false;
  profiles.splice(idx, 1);
  persist();
  return true;
}

export function importProfileFromBody(body: unknown): ImportMappingConfig | undefined {
  if (!body || typeof body !== "object") return undefined;
  return parseImportMappingConfig((body as { mapping?: unknown }).mapping);
}
