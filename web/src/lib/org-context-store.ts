import { randomUUID } from "node:crypto";
import { loadJSON, saveJSON } from "@/lib/persistence";

// docs 3.1「厳格に分離されたナレッジモデル」のCore Contextに相当する最小実装。
// v5設計書はツリー型ディレクトリ+構造化フォーマットを想定しているが、MVPでは
// 「チーム名 + メンバー一覧」だけを持つ。メンバー名はJournalのpeople配列と
// 同じ表記（例: "Aさん"）で登録する前提（表記ゆれの吸収はスコープ外）。

export type Team = {
  id: string;
  name: string;
  members: string[];
  archived: boolean;
  createdAt: number;
  updatedAt: number;
};

const teams: Team[] = loadJSON<Team[]>("teams.json", []).map((team) => ({
  ...team,
  archived: team.archived ?? false,
  updatedAt: team.updatedAt ?? team.createdAt,
}));

function persist(): void {
  saveJSON("teams.json", teams);
}

export function listTeams(): Team[] {
  return teams;
}

// vitals算出とAgent Runtimeへの「絶対の前提」注入では、アーカイブ済みチームは
// 既に活動していないチームとして除外する（docs/memo.md「チームの編集・アーカイブ」対応）。
export function listActiveTeams(): Team[] {
  return teams.filter((t) => !t.archived);
}

export function getTeam(id: string): Team | undefined {
  return teams.find((t) => t.id === id);
}

export function addTeam(name: string, members: string[]): Team {
  const now = Date.now();
  const team: Team = {
    id: randomUUID(),
    name: name.trim(),
    members: members.map((m) => m.trim()).filter(Boolean),
    archived: false,
    createdAt: now,
    updatedAt: now,
  };
  teams.push(team);
  persist();
  return team;
}

export function updateTeam(id: string, patch: { name?: string; members?: string[] }): Team | undefined {
  const team = getTeam(id);
  if (!team) return undefined;
  if (patch.name !== undefined) team.name = patch.name.trim();
  if (patch.members !== undefined) team.members = patch.members.map((m) => m.trim()).filter(Boolean);
  team.updatedAt = Date.now();
  persist();
  return team;
}

export function setTeamArchived(id: string, archived: boolean): Team | undefined {
  const team = getTeam(id);
  if (!team) return undefined;
  team.archived = archived;
  team.updatedAt = Date.now();
  persist();
  return team;
}

export function removeTeam(id: string): boolean {
  const idx = teams.findIndex((t) => t.id === id);
  if (idx === -1) return false;
  teams.splice(idx, 1);
  persist();
  return true;
}

// docs 3.1「Core Context」の`Strategy/`ディレクトリに相当する最小実装。
// MVV（Mission/Vision/Values）とOKRは組織全体で1つの静的な前提として保持し、
// Agent Runtimeへ常時（Issue非依存で）注入する。空文字列は「未設定」を意味し、
// 未設定の項目はプロンプトに含めない（他のcharter系項目と同じ扱い）。
export type OrgStrategy = {
  mission: string;
  vision: string;
  values: string;
  okr: string;
};

const DEFAULT_STRATEGY: OrgStrategy = { mission: "", vision: "", values: "", okr: "" };

let strategy: OrgStrategy = {
  ...DEFAULT_STRATEGY,
  ...loadJSON<Partial<OrgStrategy>>("org-strategy.json", {}),
};

function persistStrategy(): void {
  saveJSON("org-strategy.json", strategy);
}

export function getOrgStrategy(): OrgStrategy {
  return strategy;
}

export function updateOrgStrategy(patch: Partial<OrgStrategy>): OrgStrategy {
  strategy = {
    mission: patch.mission !== undefined ? patch.mission.trim() : strategy.mission,
    vision: patch.vision !== undefined ? patch.vision.trim() : strategy.vision,
    values: patch.values !== undefined ? patch.values.trim() : strategy.values,
    okr: patch.okr !== undefined ? patch.okr.trim() : strategy.okr,
  };
  persistStrategy();
  return strategy;
}
