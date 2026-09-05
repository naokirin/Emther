import { randomUUID } from "node:crypto";

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

// MVPではプロセス内メモリのみ。永続化はCore Context DB実装時の課題（README参照）。
const teams: Team[] = [];

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
  return team;
}

export function removeTeam(id: string): boolean {
  const idx = teams.findIndex((t) => t.id === id);
  if (idx === -1) return false;
  teams.splice(idx, 1);
  return true;
}
