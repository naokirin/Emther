import { randomUUID } from "node:crypto";
import { maskForStorage, unmaskNames } from "../people-directory";
import type { ThemeRepository } from "./theme-repository";
import type { LegacyOrgTheme, OrgTheme, SuggestedTheme, ThemeStatus } from "./theme-types";

function normalizeIdList(ids: string[] | undefined): string[] {
  if (!ids?.length) return [];
  return Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean)));
}

function normalizeTheme(raw: LegacyOrgTheme): OrgTheme {
  const { embedding: _unused, evidenceIssueIds: legacyEvidenceIssueIds, ...rest } = raw;
  void _unused;
  return {
    ...rest,
    goalIds: normalizeIdList(rest.goalIds),
    evidenceJournalIds: rest.evidenceJournalIds ?? [],
    evidenceSuggestionIds: rest.evidenceSuggestionIds ?? legacyEvidenceIssueIds ?? [],
    facts: rest.facts ?? [],
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

export function createThemeService(repo: ThemeRepository) {
  const themes: OrgTheme[] = repo.load().map(normalizeTheme);

  function persist(): void {
    repo.save(themes);
  }

  function listThemes(filter?: { status?: ThemeStatus }): OrgTheme[] {
    const all = [...themes].sort((a, b) => b.updatedAt - a.updatedAt);
    if (!filter?.status) return all;
    return all.filter((t) => t.status === filter.status);
  }

  function listAdoptedThemes(): OrgTheme[] {
    return listThemes({ status: "adopted" });
  }

  function getTheme(id: string): OrgTheme | undefined {
    return themes.find((t) => t.id === id);
  }

  function toThemeView(theme: OrgTheme): OrgTheme {
    return {
      ...theme,
      title: unmaskNames(theme.title),
      summary: unmaskNames(theme.summary),
      rationale: unmaskNames(theme.rationale),
      facts: theme.facts.map(unmaskNames),
      rootCause: theme.rootCause !== undefined ? unmaskNames(theme.rootCause) : undefined,
      suggestedDirection:
        theme.suggestedDirection !== undefined ? unmaskNames(theme.suggestedDirection) : undefined,
    };
  }

  async function createTheme(
    input: SuggestedTheme & {
      status?: ThemeStatus;
      sourceRunId?: string;
      teamId?: string;
    },
  ): Promise<OrgTheme> {
    const masked = await maskThemeFields({
      title: input.title,
      summary: input.summary,
      rationale: input.rationale,
      facts: input.facts ?? [],
      rootCause: input.rootCause,
      suggestedDirection: input.suggestedDirection,
    });
    const now = Date.now();
    const status = input.status ?? "adopted";
    const theme: OrgTheme = {
      id: randomUUID(),
      ...masked,
      facts: masked.facts.filter(Boolean),
      evidenceJournalIds: input.evidenceJournalIds ?? [],
      evidenceSuggestionIds: input.evidenceSuggestionIds ?? [],
      goalIds: normalizeIdList(input.goalIds),
      status,
      sourceRunId: input.sourceRunId,
      teamId: input.teamId,
      createdAt: now,
      updatedAt: now,
      adoptedAt: status === "adopted" ? now : undefined,
    };
    themes.push(theme);
    persist();
    return theme;
  }

  async function createThemeCandidate(
    input: SuggestedTheme & { sourceRunId?: string; teamId?: string },
  ): Promise<OrgTheme> {
    return createTheme({ ...input, status: "candidate" });
  }

  function updateThemeLinks(
    id: string,
    patch: {
      goalIds?: string[] | null;
      evidenceJournalIds?: string[];
      evidenceSuggestionIds?: string[];
      teamId?: string | null;
    },
  ): OrgTheme | undefined {
    const theme = getTheme(id);
    if (!theme) return undefined;
    if (patch.goalIds !== undefined) {
      theme.goalIds = patch.goalIds === null ? [] : normalizeIdList(patch.goalIds);
    }
    if (patch.evidenceJournalIds !== undefined) {
      theme.evidenceJournalIds = normalizeIdList(patch.evidenceJournalIds);
    }
    if (patch.evidenceSuggestionIds !== undefined) {
      theme.evidenceSuggestionIds = normalizeIdList(patch.evidenceSuggestionIds);
    }
    if (patch.teamId !== undefined) {
      theme.teamId = patch.teamId ?? undefined;
    }
    theme.updatedAt = Date.now();
    persist();
    return theme;
  }

  async function adoptTheme(id: string): Promise<OrgTheme | undefined> {
    const theme = getTheme(id);
    if (!theme) return undefined;
    if (theme.status === "adopted") return theme;
    theme.status = "adopted";
    theme.adoptedAt = Date.now();
    theme.updatedAt = theme.adoptedAt;
    persist();
    return theme;
  }

  function dismissTheme(id: string): OrgTheme | undefined {
    const theme = getTheme(id);
    if (!theme) return undefined;
    theme.status = "dismissed";
    theme.updatedAt = Date.now();
    persist();
    return theme;
  }

  async function reviseTheme(
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

    const now = Date.now();
    const revised: OrgTheme = {
      ...original,
      id: randomUUID(),
      ...masked,
      facts: masked.facts.filter(Boolean),
      rootCause: masked.rootCause,
      suggestedDirection: masked.suggestedDirection,
      supersedes: original.id,
      createdAt: now,
      updatedAt: now,
      adoptedAt: original.status === "adopted" ? now : original.adoptedAt,
    };
    original.status = "dismissed";
    original.updatedAt = now;
    themes.push(revised);
    persist();
    return revised;
  }

  function listCurrentThemes(filter?: { status?: ThemeStatus }): OrgTheme[] {
    const superseded = new Set(themes.map((t) => t.supersedes).filter((id): id is string => !!id));
    return listThemes(filter).filter((t) => !superseded.has(t.id));
  }

  return {
    listThemes,
    listAdoptedThemes,
    getTheme,
    toThemeView,
    createTheme,
    createThemeCandidate,
    updateThemeLinks,
    adoptTheme,
    dismissTheme,
    reviseTheme,
    listCurrentThemes,
  };
}
