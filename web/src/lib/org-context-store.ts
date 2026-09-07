import { randomUUID } from "node:crypto";
import { loadJSON, saveJSON } from "@/lib/persistence";
import { recordChangeEvent } from "@/lib/knowledge-store";
import { normalizeTeamName } from "@/lib/types";
import { maskForStorage, registerName, unmaskNames } from "@/lib/people-directory";
import { listIssues } from "@/lib/issue-store";

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

// docs/memo.md「I. チーム単位の憲法（ミッション／制約）」対応。組織全体のMVV
// （org全体で1つ）とは別に、チームごとの「このチームは何のためにあり、何を制約と
// するか」を持たせる。空文字列は「未設定」を意味し、未設定の項目はAgent Runtimeへの
// 注入時に省略する（Issue charterと同じ考え方）。
export type TeamCharter = {
  mission: string;
  constraints: string;
};

export type Team = {
  id: string;
  name: string;
  members: string[];
  charter: TeamCharter;
  archived: boolean;
  createdAt: number;
  updatedAt: number;
};

function emptyTeamCharter(): TeamCharter {
  return { mission: "", constraints: "" };
}

const teams: Team[] = loadJSON<Team[]>("teams.json", []).map((team) => ({
  ...team,
  charter: team.charter ?? emptyTeamCharter(),
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

// 個人情報の分離（ユーザー指摘対応）: members/charterはPERSON_n IDでマスクされた
// 状態で保持している。EM向けの応答を組み立てる境界だけで実名へ復元する。
export function toTeamView(team: Team): Team {
  return {
    ...team,
    members: team.members.map(unmaskNames),
    charter: { mission: unmaskNames(team.charter.mission), constraints: unmaskNames(team.charter.constraints) },
  };
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
    charter: emptyTeamCharter(),
    archived: false,
    createdAt: now,
    updatedAt: now,
  };
  teams.push(team);
  persist();
  recordChangeEvent("team", team.id, `チームを作成: 「${team.name}」`);
  return team;
}

export async function updateTeam(
  id: string,
  patch: { name?: string; members?: string[]; mission?: string; constraints?: string },
): Promise<Team | undefined> {
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
  // Mission/Constraintsは自由記述で人物名を含み得るため、org-strategy.tsと同じく
  // maskForStorage（ローカルNER検出＋PERSON_n置換）を通す。
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
// MVV（Mission/Vision/Values）は組織全体で1つの静的な前提として保持し、
// Agent Runtimeへ常時（Issue非依存で）注入する。空文字列は「未設定」を意味し、
// 未設定の項目はプロンプトに含めない（他のcharter系項目と同じ扱い）。
// OKRはdocs/memo.md「H」対応でObjective/KeyResultとして別途構造化した
// （下記参照）ため、ここには含まない。
export type OrgStrategy = {
  mission: string;
  vision: string;
  values: string;
};

const DEFAULT_STRATEGY: OrgStrategy = { mission: "", vision: "", values: "" };

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

// Mission/Vision/Valuesは自由記述テキストであり、人物名を含む文章になり得るため
// （例: 「Aさんを技術リードに任命する」）、Teamのmembersとは異なりNERでの検出が必要。
export async function updateOrgStrategy(patch: Partial<OrgStrategy>): Promise<OrgStrategy> {
  strategy = {
    mission: patch.mission !== undefined ? await maskForStorage(patch.mission.trim()) : strategy.mission,
    vision: patch.vision !== undefined ? await maskForStorage(patch.vision.trim()) : strategy.vision,
    values: patch.values !== undefined ? await maskForStorage(patch.values.trim()) : strategy.values,
  };
  persistStrategy();
  return strategy;
}

// docs/memo.md「H. 戦略→Issue→結果の一本線」対応。以前は自由記述1本の`okr`だったものを、
// Objective（目標）ごとにKeyResult（主要な結果、短文）を持つ最小構造へ置き換える。
// 進捗（何件のIssueが紐付き、何件完了か）はissue-store.ts側のデータから計算する
// ものであり、ここでは持たない（このストアはあくまで目標の構造だけを持つ）。
export type KeyResult = {
  id: string;
  title: string;
};

export type Objective = {
  id: string;
  title: string;
  keyResults: KeyResult[];
  createdAt: number;
  updatedAt: number;
};

const objectives: Objective[] = loadJSON<Objective[]>("objectives.json", []);

function persistObjectives(): void {
  saveJSON("objectives.json", objectives);
}

export function listObjectives(): Objective[] {
  return objectives;
}

export function getObjective(id: string): Objective | undefined {
  return objectives.find((o) => o.id === id);
}

export async function addObjective(title: string): Promise<Objective> {
  const now = Date.now();
  const objective: Objective = {
    id: randomUUID(),
    title: await maskForStorage(title.trim()),
    keyResults: [],
    createdAt: now,
    updatedAt: now,
  };
  objectives.push(objective);
  persistObjectives();
  recordChangeEvent("org", objective.id, `Objectiveを作成: 「${objective.title}」`);
  return objective;
}

export async function renameObjective(id: string, title: string): Promise<Objective | undefined> {
  const objective = getObjective(id);
  if (!objective) return undefined;
  const nextTitle = await maskForStorage(title.trim());
  if (nextTitle === objective.title) return objective;
  const prevTitle = objective.title;
  objective.title = nextTitle;
  objective.updatedAt = Date.now();
  persistObjectives();
  recordChangeEvent("org", objective.id, `Objective名を変更: 「${prevTitle}」→「${nextTitle}」`);
  return objective;
}

export function removeObjective(id: string): boolean {
  const idx = objectives.findIndex((o) => o.id === id);
  if (idx === -1) return false;
  const objective = objectives[idx];
  objectives.splice(idx, 1);
  persistObjectives();
  recordChangeEvent("org", objective.id, `Objectiveを削除しました: 「${objective.title}」`);
  return true;
}

export async function addKeyResult(objectiveId: string, title: string): Promise<Objective | undefined> {
  const objective = getObjective(objectiveId);
  if (!objective) return undefined;
  const kr: KeyResult = { id: randomUUID(), title: await maskForStorage(title.trim()) };
  objective.keyResults.push(kr);
  objective.updatedAt = Date.now();
  persistObjectives();
  recordChangeEvent("org", objective.id, `Key Resultを追加: 「${kr.title}」`);
  return objective;
}

export function removeKeyResult(objectiveId: string, keyResultId: string): Objective | undefined {
  const objective = getObjective(objectiveId);
  if (!objective) return undefined;
  const idx = objective.keyResults.findIndex((k) => k.id === keyResultId);
  if (idx === -1) return objective;
  const kr = objective.keyResults[idx];
  objective.keyResults.splice(idx, 1);
  objective.updatedAt = Date.now();
  persistObjectives();
  recordChangeEvent("org", objective.id, `Key Resultを削除しました: 「${kr.title}」`);
  return objective;
}

export type KeyResultProgress = { keyResultId: string; total: number; done: number };
export type ObjectiveWithProgress = Objective & { progress: KeyResultProgress[] };

// docs/memo.md「H」対応。進捗は手動入力ではなく、KeyResultへ紐付いたIssueの
// 完了（archived）件数から機械的に算出する（Team Vitalsと同じ「観測から出す」考え方）。
export function listObjectivesWithProgress(): ObjectiveWithProgress[] {
  const issues = listIssues();
  return objectives.map((o) => ({
    ...o,
    progress: o.keyResults.map((kr) => {
      const linked = issues.filter((i) => i.keyResultId === kr.id);
      return { keyResultId: kr.id, total: linked.length, done: linked.filter((i) => i.archived).length };
    }),
  }));
}

// 個人情報の分離（ユーザー指摘対応）: title（Objective/KeyResultとも自由記述）は
// PERSON_n IDでマスクされた状態で保持している。EM向けの応答を組み立てる境界だけで
// 実名へ復元する。
export function toObjectiveView<T extends Objective>(objective: T): T {
  return {
    ...objective,
    title: unmaskNames(objective.title),
    keyResults: objective.keyResults.map((k) => ({ ...k, title: unmaskNames(k.title) })),
  };
}
