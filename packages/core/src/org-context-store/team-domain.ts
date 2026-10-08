import { randomUUID } from "node:crypto";
import { recordChangeEvent } from "../knowledge-store";
import { maskForStorage, registerName, unmaskNames } from "../people-directory";
import { normalizeTeamName, teamDisplayName, teamPathSegments } from "../types";
import type { TeamRepository } from "./team-repository";
import type { Team, TeamCharter } from "./team-types";

function emptyTeamCharter(): TeamCharter {
  return { mission: "", constraints: "" };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceAllAtOnce(text: string, mapping: Map<string, string>): string {
  const keys = [...mapping.keys()].filter(Boolean).sort((a, b) => b.length - a.length);
  if (keys.length === 0) return text;
  const pattern = new RegExp(keys.map(escapeRegExp).join("|"), "g");
  return text.replace(pattern, (match) => mapping.get(match) ?? match);
}

function maskMembers(members: string[]): string[] {
  return members
    .map((m) => m.trim())
    .filter(Boolean)
    .map((m) => registerName(m));
}

export function createTeamService(repo: TeamRepository) {
  let teamCounter = 0;

  function nextMaskId(): string {
    teamCounter += 1;
    return `TEAM_${teamCounter}`;
  }

  function normalizeTeam(team: Team & { maskId?: string }): Team {
    let maskId = team.maskId;
    if (!maskId || !/^TEAM_\d+$/.test(maskId)) {
      maskId = nextMaskId();
    } else {
      const n = Number(maskId.slice(5));
      if (Number.isFinite(n) && n > teamCounter) teamCounter = n;
    }
    return {
      ...team,
      maskId,
      charter: team.charter ?? emptyTeamCharter(),
      archived: team.archived ?? false,
      managedByEm: team.managedByEm ?? true,
      aliases: team.aliases ?? [],
      updatedAt: team.updatedAt ?? team.createdAt,
    };
  }

  const loaded = repo.load();
  let maskIdMigrated = false;
  const teams: Team[] = loaded.map((raw) => {
    const next = normalizeTeam(raw as Team & { maskId?: string });
    if (next.maskId !== (raw as { maskId?: string }).maskId) maskIdMigrated = true;
    return next;
  });
  if (maskIdMigrated) repo.save(teams);

  function persist(): void {
    repo.save(teams);
  }

  function formatTeamToken(maskId: string): string {
    return `{{${maskId}}}`;
  }

  function buildTeamMaskMapping(): Map<string, string> {
    const out = new Map<string, string>();
    for (const team of teams) {
      for (const label of teamMatchLabels(team)) {
        if (team.maskId) out.set(label, formatTeamToken(team.maskId));
      }
    }
    return out;
  }

  /** 設定ON時のみ本文のチーム名をマスクする。OFFでも unmask は常に有効。 */
  function maskTeamNames(text: string, enabled: boolean): string {
    if (!enabled) return text;
    return replaceAllAtOnce(text, buildTeamMaskMapping());
  }

  function unmaskTeamNames(text: string): string {
    const idToName = new Map(
      teams.filter((t): t is Team & { maskId: string } => !!t.maskId).map((t) => [t.maskId, teamDisplayName(t.name)]),
    );
    const fromTokens = text.replace(/\{\{(TEAM_\d+)\}\}/g, (full, id: string) => idToName.get(id) ?? full);
    return fromTokens.replace(/TEAM_\d+/g, (full) => idToName.get(full) ?? full);
  }

  function detectLeakedTeamNames(text: string, enabled: boolean): string[] {
    if (!enabled) return [];
    const hits: string[] = [];
    for (const label of buildTeamMaskMapping().keys()) {
      if (label && text.includes(label)) hits.push(label);
    }
    return hits;
  }

  function teamLabelForPrompt(team: Team, maskEnabled: boolean): string {
    if (maskEnabled && team.maskId) return team.maskId;
    return teamDisplayName(team.name);
  }

  function listTeams(): Team[] {
    return teams;
  }

  function listActiveTeams(): Team[] {
    return teams.filter((t) => !t.archived);
  }

  function getTeam(id: string): Team | undefined {
    return teams.find((t) => t.id === id);
  }

  function toTeamView(team: Team): Team {
    return {
      ...team,
      members: team.members.map(unmaskNames),
      charter: {
        mission: unmaskNames(team.charter.mission),
        constraints: unmaskNames(team.charter.constraints),
      },
    };
  }

  function teamMatchLabels(team: Pick<Team, "name" | "aliases">): string[] {
    return [team.name, ...teamPathSegments(team.name), ...team.aliases]
      .map((s) => s.trim())
      .filter(Boolean)
      .sort((a, b) => b.length - a.length);
  }

  function findMentionedTeamIds(text: string): string[] {
    if (!text.trim()) return [];
    const ids: string[] = [];
    const ranked = [...listActiveTeams()].sort((a, b) => b.name.length - a.name.length);
    for (const team of ranked) {
      if (teamMatchLabels(team).some((label) => text.includes(label))) {
        ids.push(team.id);
      }
    }
    return ids;
  }

  function resolveTeamIdsByLabels(labels: string[]): string[] {
    const ids: string[] = [];
    for (const raw of labels) {
      const label = raw.trim();
      if (!label) continue;
      const found = teams.find((t) => {
        const cands = new Set([t.name, teamDisplayName(t.name), ...teamPathSegments(t.name), ...t.aliases]);
        return cands.has(label);
      });
      if (found && !ids.includes(found.id)) ids.push(found.id);
    }
    return ids;
  }

  function filterValidTeamIds(ids: string[], includeArchived = true): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const id of ids) {
      if (seen.has(id)) continue;
      const team = getTeam(id);
      if (!team) continue;
      if (!includeArchived && team.archived) continue;
      seen.add(id);
      out.push(id);
    }
    return out;
  }

  function addTeam(name: string, members: string[]): Team {
    const now = Date.now();
    const team: Team = {
      id: randomUUID(),
      name: normalizeTeamName(name),
      members: maskMembers(members),
      charter: emptyTeamCharter(),
      archived: false,
      managedByEm: true,
      aliases: [],
      maskId: nextMaskId(),
      createdAt: now,
      updatedAt: now,
    };
    teams.push(team);
    persist();
    recordChangeEvent("team", team.id, `チームを作成: 「${team.name}」`);
    return team;
  }

  async function updateTeam(
    id: string,
    patch: {
      name?: string;
      members?: string[];
      mission?: string;
      constraints?: string;
      managedByEm?: boolean;
      aliases?: string[];
    },
  ): Promise<Team | undefined> {
    const team = getTeam(id);
    if (!team) return undefined;
    const changes: string[] = [];
    if (patch.managedByEm !== undefined && patch.managedByEm !== team.managedByEm) {
      changes.push(patch.managedByEm ? "自分が管理するチームに設定しました" : "自分が管理するチームから外しました");
      team.managedByEm = patch.managedByEm;
    }
    if (patch.aliases !== undefined) {
      const nextAliases = Array.from(new Set(patch.aliases.map((a) => a.trim()).filter(Boolean)));
      if (nextAliases.join(",") !== team.aliases.join(",")) {
        changes.push(`別名: 「${team.aliases.join(", ") || "(なし)"}」→「${nextAliases.join(", ") || "(なし)"}」`);
        team.aliases = nextAliases;
      }
    }
    if (patch.name !== undefined) {
      const nextName = normalizeTeamName(patch.name);
      if (nextName !== team.name) {
        changes.push(`名前: 「${team.name}」→「${nextName}」`);
        team.name = nextName;
      }
    }
    if (patch.members !== undefined) {
      const nextMembers = maskMembers(patch.members);
      if (nextMembers.join(",") !== team.members.join(",")) {
        changes.push(`メンバー: 「${team.members.join(", ") || "(なし)"}」→「${nextMembers.join(", ") || "(なし)"}」`);
        team.members = nextMembers;
      }
    }
    if (patch.mission !== undefined) {
      const nextMission = await maskForStorage(patch.mission.trim());
      if (nextMission !== team.charter.mission) {
        changes.push("Missionを更新しました");
        team.charter.mission = nextMission;
      }
    }
    if (patch.constraints !== undefined) {
      const nextConstraints = await maskForStorage(patch.constraints.trim());
      if (nextConstraints !== team.charter.constraints) {
        changes.push("制約を更新しました");
        team.charter.constraints = nextConstraints;
      }
    }
    if (changes.length === 0) return team;
    team.updatedAt = Date.now();
    persist();
    recordChangeEvent("team", team.id, changes.join(" / "));
    return team;
  }

  function setTeamArchived(id: string, archived: boolean): Team | undefined {
    const team = getTeam(id);
    if (!team) return undefined;
    if (team.archived === archived) return team;
    team.archived = archived;
    team.updatedAt = Date.now();
    persist();
    recordChangeEvent("team", team.id, archived ? "アーカイブしました" : "アーカイブを解除しました");
    return team;
  }

  function removeTeam(id: string): boolean {
    const idx = teams.findIndex((t) => t.id === id);
    if (idx === -1) return false;
    const team = teams[idx];
    teams.splice(idx, 1);
    persist();
    recordChangeEvent("team", team.id, `チームを削除しました: 「${team.name}」`);
    return true;
  }

  function reassignPersonIdInTeams(fromId: string, toId: string): void {
    let changed = false;
    for (const team of teams) {
      const idx = team.members.indexOf(fromId);
      if (idx === -1) continue;
      changed = true;
      if (team.members.includes(toId)) {
        team.members.splice(idx, 1);
      } else {
        team.members[idx] = toId;
      }
      team.updatedAt = Date.now();
    }
    if (changed) persist();
  }

  return {
    listTeams,
    listActiveTeams,
    getTeam,
    toTeamView,
    teamMatchLabels,
    findMentionedTeamIds,
    resolveTeamIdsByLabels,
    filterValidTeamIds,
    addTeam,
    updateTeam,
    setTeamArchived,
    removeTeam,
    reassignPersonIdInTeams,
    maskTeamNames,
    unmaskTeamNames,
    detectLeakedTeamNames,
    teamLabelForPrompt,
  };
}
