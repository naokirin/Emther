import { randomUUID } from "node:crypto";
import { loadJSON, saveJSON } from "../persistence";
import { recordChangeEvent } from "../knowledge-store";
import { maskForStorage, unmaskNames } from "../people-directory";

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

// KeyResult進捗（org-context-store⇄issue-storeを横断する集計）は@/lib/objective-progressの
// listObjectivesWithProgress/ObjectiveWithProgress/KeyResultProgressへ移した。

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
