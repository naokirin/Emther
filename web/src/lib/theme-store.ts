import { randomUUID } from "node:crypto";
import { loadJSON, saveJSON } from "@/lib/persistence";
import { embedText } from "@/lib/embeddings";
import { maskForStorage, unmaskNames } from "@/lib/people-directory";

// docs/knowledge_distillation.md 対応。Journal fact の類似検索だけでは「上段の解釈」に
// 届かないため、組織状況を統括したテーマ解釈を first-class に持つ。
// EM が採用するまで Issue 壁打ち等の前提には入れない（Human-in-the-Loop）。

export type ThemeStatus = "candidate" | "adopted" | "dismissed";

export type OrgTheme = {
  id: string;
  title: string;
  summary: string;
  rationale: string;
  facts: string[];
  rootCause?: string;
  suggestedDirection?: string;
  evidenceJournalIds: string[];
  evidenceIssueIds: string[];
  status: ThemeStatus;
  sourceRunId?: string;
  teamId?: string;
  embedding?: number[];
  supersedes?: string;
  createdAt: number;
  updatedAt: number;
  adoptedAt?: number;
};

export type SuggestedTheme = {
  title: string;
  summary: string;
  rationale: string;
  facts: string[];
  rootCause?: string;
  suggestedDirection?: string;
  evidenceJournalIds?: string[];
  evidenceIssueIds?: string[];
};

const themes: OrgTheme[] = loadJSON<OrgTheme[]>("themes.json", []);

function persist(): void {
  saveJSON("themes.json", themes);
}

export function listThemes(filter?: { status?: ThemeStatus }): OrgTheme[] {
  const all = [...themes].sort((a, b) => b.updatedAt - a.updatedAt);
  if (!filter?.status) return all;
  return all.filter((t) => t.status === filter.status);
}

export function listAdoptedThemes(): OrgTheme[] {
  return listThemes({ status: "adopted" });
}

export function getTheme(id: string): OrgTheme | undefined {
  return themes.find((t) => t.id === id);
}

export function toThemeView(theme: OrgTheme): OrgTheme {
  return {
    ...theme,
    title: unmaskNames(theme.title),
    summary: unmaskNames(theme.summary),
    rationale: unmaskNames(theme.rationale),
    facts: theme.facts.map(unmaskNames),
    rootCause: theme.rootCause !== undefined ? unmaskNames(theme.rootCause) : undefined,
    suggestedDirection: theme.suggestedDirection !== undefined ? unmaskNames(theme.suggestedDirection) : undefined,
  };
}

async function maskThemeFields(input: {
  title: string;
  summary: string;
  rationale: string;
  facts: string[];
  rootCause?: string;
  suggestedDirection?: string;
}): Promise<{
  title: string;
  summary: string;
  rationale: string;
  facts: string[];
  rootCause?: string;
  suggestedDirection?: string;
}> {
  return {
    title: await maskForStorage(input.title.trim()),
    summary: await maskForStorage(input.summary.trim()),
    rationale: await maskForStorage(input.rationale.trim()),
    facts: await Promise.all(input.facts.filter((f) => f.trim()).map((f) => maskForStorage(f.trim()))),
    rootCause: input.rootCause?.trim() ? await maskForStorage(input.rootCause.trim()) : undefined,
    suggestedDirection: input.suggestedDirection?.trim()
      ? await maskForStorage(input.suggestedDirection.trim())
      : undefined,
  };
}

export async function createThemeCandidate(
  input: SuggestedTheme & { sourceRunId?: string; teamId?: string },
): Promise<OrgTheme> {
  const masked = await maskThemeFields({
    title: input.title,
    summary: input.summary,
    rationale: input.rationale,
    facts: input.facts ?? [],
    rootCause: input.rootCause,
    suggestedDirection: input.suggestedDirection,
  });
  const embedSource = [input.title, input.summary, input.rationale].filter(Boolean).join("\n");
  let embedding: number[] | undefined;
  try {
    embedding = await embedText(embedSource);
  } catch {
    embedding = undefined;
  }
  const now = Date.now();
  const theme: OrgTheme = {
    id: randomUUID(),
    ...masked,
    facts: masked.facts.filter(Boolean),
    evidenceJournalIds: input.evidenceJournalIds ?? [],
    evidenceIssueIds: input.evidenceIssueIds ?? [],
    status: "candidate",
    sourceRunId: input.sourceRunId,
    teamId: input.teamId,
    embedding,
    createdAt: now,
    updatedAt: now,
  };
  themes.push(theme);
  persist();
  return theme;
}

export async function adoptTheme(id: string): Promise<OrgTheme | undefined> {
  const theme = getTheme(id);
  if (!theme) return undefined;
  if (theme.status === "adopted") return theme;
  theme.status = "adopted";
  theme.adoptedAt = Date.now();
  theme.updatedAt = theme.adoptedAt;
  persist();
  return theme;
}

export function dismissTheme(id: string): OrgTheme | undefined {
  const theme = getTheme(id);
  if (!theme) return undefined;
  theme.status = "dismissed";
  theme.updatedAt = Date.now();
  persist();
  return theme;
}

// 訂正はイベントソーシング方針に合わせ、新レコードを supersedes で繋ぐ。
export async function reviseTheme(
  id: string,
  patch: {
    title?: string;
    summary?: string;
    rationale?: string;
    facts?: string[];
    rootCause?: string | null;
    suggestedDirection?: string | null;
  },
): Promise<OrgTheme | undefined> {
  const original = getTheme(id);
  if (!original || original.status === "dismissed") return undefined;

  const nextTitle = patch.title !== undefined ? patch.title : original.title;
  const nextSummary = patch.summary !== undefined ? patch.summary : original.summary;
  const nextRationale = patch.rationale !== undefined ? patch.rationale : original.rationale;
  const nextFacts = patch.facts !== undefined ? patch.facts : original.facts;
  const nextRoot =
    patch.rootCause === null ? undefined : patch.rootCause !== undefined ? patch.rootCause : original.rootCause;
  const nextDirection =
    patch.suggestedDirection === null
      ? undefined
      : patch.suggestedDirection !== undefined
        ? patch.suggestedDirection
        : original.suggestedDirection;

  const masked = await maskThemeFields({
    title: nextTitle,
    summary: nextSummary,
    rationale: nextRationale,
    facts: nextFacts,
    rootCause: nextRoot,
    suggestedDirection: nextDirection,
  });

  const embedSource = [nextTitle, nextSummary, nextRationale].filter(Boolean).join("\n");
  let embedding: number[] | undefined;
  try {
    embedding = await embedText(embedSource);
  } catch {
    embedding = original.embedding;
  }

  const now = Date.now();
  const revised: OrgTheme = {
    ...original,
    id: randomUUID(),
    ...masked,
    facts: masked.facts.filter(Boolean),
    rootCause: masked.rootCause,
    suggestedDirection: masked.suggestedDirection,
    embedding,
    supersedes: original.id,
    createdAt: now,
    updatedAt: now,
    adoptedAt: original.status === "adopted" ? now : original.adoptedAt,
  };
  // 旧版は一覧の「現行」から外すため dismissed 扱い（履歴は supersedes で辿れる）。
  original.status = "dismissed";
  original.updatedAt = now;
  themes.push(revised);
  persist();
  return revised;
}

export function listCurrentThemes(filter?: { status?: ThemeStatus }): OrgTheme[] {
  const superseded = new Set(themes.map((t) => t.supersedes).filter((id): id is string => !!id));
  return listThemes(filter).filter((t) => !superseded.has(t.id));
}
