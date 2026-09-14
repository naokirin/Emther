import { randomUUID } from "node:crypto";
import { loadJSON, saveJSON } from "@/lib/persistence";
import { recordChangeEvent } from "@/lib/knowledge-store";
import { normalizeTeamName, teamDisplayName, teamPathSegments } from "@/lib/types";
import { maskForStorage, registerName, registerTeamNameCollisionChecker, unmaskNames } from "@/lib/people-directory";

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

// people-directory⇄org-context-storeの循環参照を避けるため、人名候補検出の
// 「チーム名との衝突チェック」はorg-context-store側から自分自身（listTeams）を
// 登録する（依存性逆転。people-directory.tsのregisterTeamNameCollisionChecker参照）。
registerTeamNameCollisionChecker((candidate) =>
  listTeams().some((t) => t.name === candidate || teamPathSegments(t.name).includes(candidate)),
);

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
