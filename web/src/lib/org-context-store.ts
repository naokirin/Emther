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
  createdAt: number;
};

const teams: Team[] = loadJSON<Team[]>("teams.json", []);

function persist(): void {
  saveJSON("teams.json", teams);
}

export function listTeams(): Team[] {
  return teams;
}

export function addTeam(name: string, members: string[]): Team {
  const team: Team = {
    id: randomUUID(),
    name: name.trim(),
    members: members.map((m) => m.trim()).filter(Boolean),
    createdAt: Date.now(),
  };
  teams.push(team);
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
