import { randomUUID } from "node:crypto";
import { loadJSON, saveJSON } from "@/lib/persistence";
import { recordChangeEvent } from "@/lib/knowledge-store";
import { maskForStorage, unmaskNames } from "@/lib/people-directory";

// Standing Background: 組織の長期背景事実＋いまの判断への含意。
// Journal（揺らぎ・TTL付き）や MVV/OKR（戦略）とは別枠の Core Context。
// scope=always はほぼ全 Run に注入、tagged は手がかりがあるときだけ。
export type OrgBackgroundScope = "always" | "tagged";
export type OrgBackgroundStatus = "active" | "archived";

export type OrgBackgroundEntry = {
  id: string;
  title: string;
  fact: string;
  implication: string;
  occurredOn?: string;
  tags: string[];
  scope: OrgBackgroundScope;
  status: OrgBackgroundStatus;
  createdAt: number;
  updatedAt: number;
};

export type NewOrgBackgroundInput = {
  title: string;
  fact: string;
  implication?: string;
  occurredOn?: string;
  tags?: string[];
  scope?: OrgBackgroundScope;
  status?: OrgBackgroundStatus;
};

function normalizeBackgroundTags(tags: string[] | undefined): string[] {
  if (!tags) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim();
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

function normalizeBackgroundScope(value: unknown): OrgBackgroundScope {
  return value === "tagged" ? "tagged" : "always";
}

function normalizeBackgroundStatus(value: unknown): OrgBackgroundStatus {
  return value === "archived" ? "archived" : "active";
}

const backgrounds: OrgBackgroundEntry[] = loadJSON<OrgBackgroundEntry[]>("org-background.json", []).map((e) => ({
  ...e,
  implication: e.implication ?? "",
  tags: normalizeBackgroundTags(e.tags),
  scope: normalizeBackgroundScope(e.scope),
  status: normalizeBackgroundStatus(e.status),
  updatedAt: e.updatedAt ?? e.createdAt,
}));

function persistBackgrounds(): void {
  saveJSON("org-background.json", backgrounds);
}

export function listOrgBackgrounds(): OrgBackgroundEntry[] {
  return backgrounds;
}

export function listActiveOrgBackgrounds(): OrgBackgroundEntry[] {
  return backgrounds.filter((e) => e.status === "active");
}

export function getOrgBackground(id: string): OrgBackgroundEntry | undefined {
  return backgrounds.find((e) => e.id === id);
}

export async function addOrgBackground(input: NewOrgBackgroundInput): Promise<OrgBackgroundEntry> {
  const title = input.title.trim();
  const fact = input.fact.trim();
  if (!title || !fact) {
    throw new Error("titleとfactは必須です");
  }
  const now = Date.now();
  const occurredOn = input.occurredOn?.trim() || undefined;
  const implication = input.implication?.trim() ?? "";
  const entry: OrgBackgroundEntry = {
    id: randomUUID(),
    title: await maskForStorage(title),
    fact: await maskForStorage(fact),
    implication: implication ? await maskForStorage(implication) : "",
    ...(occurredOn ? { occurredOn } : {}),
    tags: normalizeBackgroundTags(input.tags),
    scope: normalizeBackgroundScope(input.scope),
    status: normalizeBackgroundStatus(input.status),
    createdAt: now,
    updatedAt: now,
  };
  backgrounds.push(entry);
  persistBackgrounds();
  recordChangeEvent("org", entry.id, `Standing Backgroundを作成: 「${entry.title}」`);
  return entry;
}

export async function updateOrgBackground(
  id: string,
  patch: {
    title?: string;
    fact?: string;
    implication?: string | null;
    occurredOn?: string | null;
    tags?: string[];
    scope?: OrgBackgroundScope;
    status?: OrgBackgroundStatus;
  },
): Promise<OrgBackgroundEntry | undefined> {
  const entry = getOrgBackground(id);
  if (!entry) return undefined;
  const changes: string[] = [];

  if (patch.title !== undefined) {
    const next = await maskForStorage(patch.title.trim());
    if (next && next !== entry.title) {
      changes.push(`見出し: 「${entry.title}」→「${next}」`);
      entry.title = next;
    }
  }
  if (patch.fact !== undefined) {
    const next = await maskForStorage(patch.fact.trim());
    if (next && next !== entry.fact) {
      changes.push("事実を更新しました");
      entry.fact = next;
    }
  }
  if (patch.implication !== undefined) {
    const raw = patch.implication === null ? "" : patch.implication.trim();
    const next = raw ? await maskForStorage(raw) : "";
    if (next !== entry.implication) {
      changes.push(next ? "含意を更新しました" : "含意を削除しました");
      entry.implication = next;
    }
  }
  if (patch.occurredOn !== undefined) {
    const next = patch.occurredOn === null || !patch.occurredOn.trim() ? undefined : patch.occurredOn.trim();
    if (next !== entry.occurredOn) {
      changes.push(next ? `時期: ${next}` : "時期を削除しました");
      if (next) entry.occurredOn = next;
      else delete entry.occurredOn;
    }
  }
  if (patch.tags !== undefined) {
    const next = normalizeBackgroundTags(patch.tags);
    if (JSON.stringify(next) !== JSON.stringify(entry.tags)) {
      changes.push("タグを更新しました");
      entry.tags = next;
    }
  }
  if (patch.scope !== undefined) {
    const next = normalizeBackgroundScope(patch.scope);
    if (next !== entry.scope) {
      changes.push(`注入範囲: ${entry.scope}→${next}`);
      entry.scope = next;
    }
  }
  if (patch.status !== undefined) {
    const next = normalizeBackgroundStatus(patch.status);
    if (next !== entry.status) {
      changes.push(next === "archived" ? "アーカイブしました" : "有効に戻しました");
      entry.status = next;
    }
  }

  if (changes.length === 0) return entry;
  entry.updatedAt = Date.now();
  persistBackgrounds();
  recordChangeEvent("org", entry.id, changes.join(" / "));
  return entry;
}

export function removeOrgBackground(id: string): boolean {
  const idx = backgrounds.findIndex((e) => e.id === id);
  if (idx === -1) return false;
  const entry = backgrounds[idx];
  backgrounds.splice(idx, 1);
  persistBackgrounds();
  recordChangeEvent("org", entry.id, `Standing Backgroundを削除しました: 「${entry.title}」`);
  return true;
}

export function toOrgBackgroundView(entry: OrgBackgroundEntry): OrgBackgroundEntry {
  return {
    ...entry,
    title: unmaskNames(entry.title),
    fact: unmaskNames(entry.fact),
    implication: unmaskNames(entry.implication),
  };
}
