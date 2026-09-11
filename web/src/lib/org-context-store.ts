import { randomUUID } from "node:crypto";
import { loadJSON, saveJSON } from "@/lib/persistence";
import { recordChangeEvent } from "@/lib/knowledge-store";
import { normalizeTeamName, teamDisplayName, teamPathSegments } from "@/lib/types";
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
  // ユーザー要望「部下(自分が管理するチームのメンバー)とそれ以外を分けたい」対応。
  // types.tsのTeam型のコメント参照。
  managedByEm: boolean;
  // ユーザー要望「チーム名についても表記揺れ対応できると嬉しい」対応。relevantTeams
  // （agent-runtime.ts、EMの自由記述からどのチームの話か推定する処理）が正式名と併せて
  // 照合対象にする代替の呼び方（略称・旧名等）。チーム名自体と同じく個人情報ではないため
  // マスク対象にしない。
  aliases: string[];
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
  // 既存チーム（フィールド未保存）は「自分が管理するチーム」として扱う（既定を変えない）。
  managedByEm: team.managedByEm ?? true,
  aliases: team.aliases ?? [],
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

/** チーム名照合用のラベル（正式名・階層セグメント・別名）。長いもの優先で誤マッチを減らす。 */
export function teamMatchLabels(team: Pick<Team, "name" | "aliases">): string[] {
  return [team.name, ...teamPathSegments(team.name), ...team.aliases]
    .map((s) => s.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
}

/**
 * 登録済みチーム名（＋別名・階層セグメント）が本文に含まれるかで Team.id を拾う。
 * agent-runtime の relevantTeams と同じ手がかり。アーカイブ済みは除外。
 */
export function findMentionedTeamIds(text: string): string[] {
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

/**
 * EM校正・ローカル抽出のチーム名ラベルを Team.id へ解決する。
 * 正式名・表示名・セグメント・別名の完全一致のみ（部分一致は誤紐付けが多いためしない）。
 * アーカイブ済みも含めて解決する（既に紐付いているチームを校正で維持できるように）。
 */
export function resolveTeamIdsByLabels(labels: string[]): string[] {
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

/**
 * 有効な Team.id だけを残す（削除済みチームの孤児IDを落とす）。
 * includeArchived=true ならアーカイブ済みも有効とみなす。
 */
export function filterValidTeamIds(ids: string[], includeArchived = true): string[] {
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
    managedByEm: true,
    aliases: [],
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

// ユーザー要望「誤って複数登録されてしまったメンバーを統合する機能が欲しい」対応。
// 統合元（fromId）がメンバーに含まれるチームで、fromIdをtoIdへ置き換える。統合先
// （toId）が既にそのチームのメンバーなら、fromIdは単に取り除く（重複メンバー化を防ぐ）。
export function reassignPersonIdInTeams(fromId: string, toId: string): void {
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
  // docs/usage_issues U18: 判断理由などの補足。未設定時は省略。
  note?: string;
  // ユーザー要望「目標は組織内でカスケーディングされるもの(上位組織の目標達成のために
  // 下位組織の目標がある)なので、それを意識した構成にしたい」対応。未指定＝組織全体の
  // トップレベル目標、指定時はそのチーム自身の目標（＝上位の組織目標を達成するための
  // 下位目標）であることを表す。チームの親子関係はTeam.name（"/"区切り）にそのまま乗る
  // ため、Objective側に別途parentObjectiveId等は持たせない。
  teamId?: string;
  keyResults: KeyResult[];
  createdAt: number;
  updatedAt: number;
};

export type ObjectiveImportDraft = {
  title: string;
  note?: string;
  keyResults: string[];
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

export async function addObjective(title: string, teamId?: string, note?: string): Promise<Objective> {
  const now = Date.now();
  const trimmedNote = note?.trim();
  const objective: Objective = {
    id: randomUUID(),
    title: await maskForStorage(title.trim()),
    ...(trimmedNote ? { note: await maskForStorage(trimmedNote) } : {}),
    teamId,
    keyResults: [],
    createdAt: now,
    updatedAt: now,
  };
  objectives.push(objective);
  persistObjectives();
  recordChangeEvent("org", objective.id, `Objectiveを作成: 「${objective.title}」`);
  return objective;
}

// ユーザー要望「目標のカスケーディング構成」対応。renameObjectiveをtitle/teamId両方の
// 部分更新に拡張した（updateTeamと同じ、変更のあったフィールドだけ更新する規約）。
// teamId: undefined＝変更しない、null＝組織全体の目標に戻す、string＝そのチームの目標にする
// （updateJournalEntryのresolvedIssueIdと同じ3値の意味付け）。
// docs/usage_issues U18: note も同様（undefined＝変更しない、null／空＝クリア、string＝設定）。
export async function updateObjective(
  id: string,
  patch: { title?: string; teamId?: string | null; note?: string | null },
): Promise<Objective | undefined> {
  const objective = getObjective(id);
  if (!objective) return undefined;
  const changes: string[] = [];
  if (patch.title !== undefined) {
    const nextTitle = await maskForStorage(patch.title.trim());
    if (nextTitle && nextTitle !== objective.title) {
      changes.push(`名前: 「${objective.title}」→「${nextTitle}」`);
      objective.title = nextTitle;
    }
  }
  if (patch.teamId !== undefined) {
    const nextTeamId = patch.teamId ?? undefined;
    if (nextTeamId !== objective.teamId) {
      changes.push(nextTeamId ? "所属チームを設定しました" : "組織全体の目標に変更しました");
      objective.teamId = nextTeamId;
    }
  }
  if (patch.note !== undefined) {
    const nextNote = patch.note === null || !patch.note.trim() ? undefined : await maskForStorage(patch.note.trim());
    if (nextNote !== objective.note) {
      changes.push(nextNote ? "メモを更新しました" : "メモを削除しました");
      if (nextNote) objective.note = nextNote;
      else delete objective.note;
    }
  }
  if (changes.length === 0) return objective;
  objective.updatedAt = Date.now();
  persistObjectives();
  recordChangeEvent("org", objective.id, changes.join(" / "));
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

// docs/usage_issues U18: Key Result のタイトル編集（従来は追加・削除のみだった）。
export async function updateKeyResult(
  objectiveId: string,
  keyResultId: string,
  title: string,
): Promise<Objective | undefined> {
  const objective = getObjective(objectiveId);
  if (!objective) return undefined;
  const kr = objective.keyResults.find((k) => k.id === keyResultId);
  if (!kr) return undefined;
  const nextTitle = await maskForStorage(title.trim());
  if (!nextTitle || nextTitle === kr.title) return objective;
  const prev = kr.title;
  kr.title = nextTitle;
  objective.updatedAt = Date.now();
  persistObjectives();
  recordChangeEvent("org", objective.id, `Key Resultを更新: 「${prev}」→「${nextTitle}」`);
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

/** 同一 teamId スコープ（未指定＝組織全体）の Objective を列挙する。 */
function objectivesInScope(teamId?: string): Objective[] {
  return objectives.filter((o) => (teamId ? o.teamId === teamId : !o.teamId));
}

/**
 * docs/usage_issues U18: 構造化済みドラフトを一括保存する。
 * mode=append は追加のみ。mode=replace は同一スコープ（teamId 一致／組織全体）の既存を削除してから追加。
 */
export async function importObjectives(
  drafts: ObjectiveImportDraft[],
  opts: { mode: "append" | "replace"; teamId?: string },
): Promise<Objective[]> {
  const cleaned = drafts
    .map((d) => ({
      title: d.title.trim(),
      note: d.note?.trim() || undefined,
      keyResults: d.keyResults.map((t) => t.trim()).filter(Boolean),
    }))
    .filter((d) => d.title);

  if (opts.mode === "replace") {
    for (const existing of [...objectivesInScope(opts.teamId)]) {
      removeObjective(existing.id);
    }
  }

  const created: Objective[] = [];
  for (const draft of cleaned) {
    const objective = await addObjective(draft.title, opts.teamId, draft.note);
    for (const krTitle of draft.keyResults) {
      await addKeyResult(objective.id, krTitle);
    }
    const fresh = getObjective(objective.id);
    if (fresh) created.push(fresh);
  }
  return created;
}

export type KeyResultProgress = { keyResultId: string; total: number; done: number };
export type ObjectiveWithProgress = Objective & { progress: KeyResultProgress[] };

// docs/memo.md「H」対応。進捗は手動入力ではなく、KeyResultへ紐付いたIssueのうち
// !archived の status=done 件数から機械的に算出する（docs/issue_tracker_contract.md §4）。
export function listObjectivesWithProgress(): ObjectiveWithProgress[] {
  const issues = listIssues();
  return objectives.map((o) => ({
    ...o,
    progress: o.keyResults.map((kr) => {
      const linked = issues.filter((i) => i.keyResultId === kr.id && !i.archived);
      return {
        keyResultId: kr.id,
        total: linked.length,
        done: linked.filter((i) => i.status === "done").length,
      };
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
    ...(objective.note !== undefined ? { note: unmaskNames(objective.note) } : {}),
    keyResults: objective.keyResults.map((k) => ({ ...k, title: unmaskNames(k.title) })),
  };
}

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
