import { randomUUID } from "node:crypto";
import { loadJSON, saveJSON } from "@/lib/persistence";
import { recordChangeEvent } from "@/lib/knowledge-store";
import { normalizeTeamName } from "@/lib/types";
import { maskForStorage, registerName } from "@/lib/people-directory";

// docs 3.1「厳格に分離されたナレッジモデル」のCore Contextに相当する最小実装。
// v5設計書はツリー型ディレクトリ+構造化フォーマットを想定しているが、MVPでは
// 「チーム名 + メンバー一覧」だけを持つ。メンバー名はJournalのpeople配列と
// 同じ表記（例: "Aさん"）で登録する前提（表記ゆれの吸収はスコープ外）。
// チーム名に`/`を含めると組織階層を表現できる（docs/memo.md TODO対応、
// 詳細は`@/lib/types`の`teamPathSegments`を参照）。保存時に`normalizeTeamName`で
// 区切り前後の空白を除いた正規形にし、表記ゆれ（"A / B" と "A/B"）を吸収する。
//
// 重要: 個人情報の分離（ユーザー指摘対応）。`members`は実名ではなく
// people-directory.tsが発行する`PERSON_n` IDで保存する（＝クラウドLLMが
// アクセスできるどのストアにも実名を書き込まない）。EM向けの表示（Dashboard/
// Organization Context画面）は、これを返すAPIルート側でunmaskNamesを通してから
// 応答する。チーム名自体（例: "Engineering / Team A"）は組織構造上の識別子であり
// 個人名ではないため、マスク対象にしない。

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

// メンバー名はチーム名簿という「既に人物名だと分かっている」フィールドなので、
// 文中から名前を探すNER（maskForStorage）ではなく、直接registerNameでIDへ変換する
// （非同期のローカルモデル呼び出しが不要で高速、かつ確実）。
function maskMembers(members: string[]): string[] {
  return members
    .map((m) => m.trim())
    .filter(Boolean)
    .map((m) => registerName(m));
}

export function addTeam(name: string, members: string[]): Team {
  const now = Date.now();
  const team: Team = {
    id: randomUUID(),
    name: normalizeTeamName(name),
    members: maskMembers(members),
    archived: false,
    createdAt: now,
    updatedAt: now,
  };
  teams.push(team);
  persist();
  recordChangeEvent("team", team.id, `チームを作成: 「${team.name}」`);
  return team;
}

export function updateTeam(id: string, patch: { name?: string; members?: string[] }): Team | undefined {
  const team = getTeam(id);
  if (!team) return undefined;
  const changes: string[] = [];
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
      // 変更履歴（監査ログ）もPERSON_n IDのまま記録する（表示時にunmaskNamesを通す）。
      changes.push(`メンバー: 「${team.members.join(", ") || "(なし)"}」→「${nextMembers.join(", ") || "(なし)"}」`);
      team.members = nextMembers;
    }
  }
  if (changes.length === 0) return team;
  team.updatedAt = Date.now();
  persist();
  recordChangeEvent("team", team.id, changes.join(" / "));
  return team;
}

export function setTeamArchived(id: string, archived: boolean): Team | undefined {
  const team = getTeam(id);
  if (!team) return undefined;
  if (team.archived === archived) return team;
  team.archived = archived;
  team.updatedAt = Date.now();
  persist();
  recordChangeEvent("team", team.id, archived ? "アーカイブしました" : "アーカイブを解除しました");
  return team;
}

export function removeTeam(id: string): boolean {
  const idx = teams.findIndex((t) => t.id === id);
  if (idx === -1) return false;
  const team = teams[idx];
  teams.splice(idx, 1);
  persist();
  recordChangeEvent("team", team.id, `チームを削除しました: 「${team.name}」`);
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

// Mission/Vision/Values/OKRは自由記述テキストであり、人物名を含む文章になり得るため
// （例: 「Aさんを技術リードに任命する」）、Teamのmembersとは異なりNERでの検出が必要。
export async function updateOrgStrategy(patch: Partial<OrgStrategy>): Promise<OrgStrategy> {
  strategy = {
    mission: patch.mission !== undefined ? await maskForStorage(patch.mission.trim()) : strategy.mission,
    vision: patch.vision !== undefined ? await maskForStorage(patch.vision.trim()) : strategy.vision,
    values: patch.values !== undefined ? await maskForStorage(patch.values.trim()) : strategy.values,
    okr: patch.okr !== undefined ? await maskForStorage(patch.okr.trim()) : strategy.okr,
  };
  persistStrategy();
  return strategy;
}
