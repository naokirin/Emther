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

// docs 3.1.1「判定閾値およびデータ欠如とみなす期間はCore Context（Rules_and_Constraints）
// 側で定義」に対応。以前はvitals.ts内にハードコードされていたパラメータをここに移し、
// Organization Context側からEMが調整できるようにする。
export type RulesAndConstraints = {
  teamWindowDays: number;
  minEntriesForJudgement: number;
  teamBadSentimentMax: number;
  teamWarnSentimentMax: number;
  coverageWindowDays: number;
  coverageGoodRatio: number;
  coverageWarnRatio: number;
};

const DEFAULT_RULES: RulesAndConstraints = {
  teamWindowDays: 14,
  minEntriesForJudgement: 2,
  teamBadSentimentMax: -0.34,
  teamWarnSentimentMax: 0.2,
  coverageWindowDays: 30,
  coverageGoodRatio: 0.8,
  coverageWarnRatio: 0.4,
};

let rules: RulesAndConstraints = {
  ...DEFAULT_RULES,
  ...loadJSON<Partial<RulesAndConstraints>>("org-rules.json", {}),
};

function persistRules(): void {
  saveJSON("org-rules.json", rules);
}

export function getRulesAndConstraints(): RulesAndConstraints {
  return rules;
}

export function updateRulesAndConstraints(patch: Partial<RulesAndConstraints>): RulesAndConstraints {
  rules = { ...rules, ...patch };
  persistRules();
  return rules;
}
