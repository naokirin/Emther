import { randomUUID } from "node:crypto";
import { loadJSON, saveJSON } from "../persistence";
import { recordChangeEvent } from "../knowledge-store";
import { maskForStorage, unmaskNames } from "../people-directory";

// docs/goal_policy_model.md。EMとして見据えている「到達したい状態」。SMARTである必要はなく、
// note だけの定性的な記述から始めてよい。
export type GoalHorizon = "long" | "mid" | "near";
export type GoalStatus = "active" | "achieved" | "abandoned";

export type Goal = {
  id: string;
  title: string;
  note?: string;
  // 未指定＝組織全体、指定時はそのチーム自身のGoal（カスケーディング）。
  teamId?: string;
  // 「遠い/中間/近い」等、異なる時間軸を持ってよい。必須ではない任意ヒント。
  horizon?: GoalHorizon;
  status: GoalStatus;
  createdAt: number;
  updatedAt: number;
};

function normalizeHorizon(value: unknown): GoalHorizon | undefined {
  return value === "long" || value === "mid" || value === "near" ? value : undefined;
}

function normalizeStatus(value: unknown): GoalStatus {
  return value === "achieved" || value === "abandoned" ? value : "active";
}

const goals: Goal[] = loadJSON<Goal[]>("goals.json", []);

function persist(): void {
  saveJSON("goals.json", goals);
}

export function listGoals(): Goal[] {
  return [...goals].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function listActiveGoals(): Goal[] {
  return listGoals().filter((g) => g.status === "active");
}

export function getGoal(id: string): Goal | undefined {
  return goals.find((g) => g.id === id);
}

export async function addGoal(input: {
  title: string;
  teamId?: string;
  note?: string;
  horizon?: GoalHorizon;
}): Promise<Goal> {
  const title = input.title.trim();
  if (!title) {
    throw new Error("titleは必須です");
  }
  const now = Date.now();
  const note = input.note?.trim();
  const goal: Goal = {
    id: randomUUID(),
    title: await maskForStorage(title),
    ...(note ? { note: await maskForStorage(note) } : {}),
    teamId: input.teamId,
    horizon: normalizeHorizon(input.horizon),
    status: "active",
    createdAt: now,
    updatedAt: now,
  };
  goals.push(goal);
  persist();
  recordChangeEvent("org", goal.id, `Goalを作成: 「${goal.title}」`);
  return goal;
}

export async function updateGoal(
  id: string,
  patch: {
    title?: string;
    teamId?: string | null;
    note?: string | null;
    horizon?: GoalHorizon | null;
    status?: GoalStatus;
  },
): Promise<Goal | undefined> {
  const goal = getGoal(id);
  if (!goal) return undefined;
  const changes: string[] = [];

  if (patch.title !== undefined) {
    const next = await maskForStorage(patch.title.trim());
    if (next && next !== goal.title) {
      changes.push(`名前: 「${goal.title}」→「${next}」`);
      goal.title = next;
    }
  }
  if (patch.teamId !== undefined) {
    const next = patch.teamId ?? undefined;
    if (next !== goal.teamId) {
      changes.push(next ? "所属チームを設定しました" : "組織全体のGoalに変更しました");
      goal.teamId = next;
    }
  }
  if (patch.note !== undefined) {
    const next = patch.note === null || !patch.note.trim() ? undefined : await maskForStorage(patch.note.trim());
    if (next !== goal.note) {
      changes.push(next ? "メモを更新しました" : "メモを削除しました");
      if (next) goal.note = next;
      else delete goal.note;
    }
  }
  if (patch.horizon !== undefined) {
    const next = patch.horizon === null ? undefined : normalizeHorizon(patch.horizon);
    if (next !== goal.horizon) {
      changes.push(next ? `時間軸: ${next}` : "時間軸を解除しました");
      goal.horizon = next;
    }
  }
  if (patch.status !== undefined) {
    const next = normalizeStatus(patch.status);
    if (next !== goal.status) {
      changes.push(`状態: ${goal.status}→${next}`);
      goal.status = next;
    }
  }

  if (changes.length === 0) return goal;
  goal.updatedAt = Date.now();
  persist();
  recordChangeEvent("org", goal.id, changes.join(" / "));
  return goal;
}

export function removeGoal(id: string): boolean {
  const idx = goals.findIndex((g) => g.id === id);
  if (idx === -1) return false;
  const goal = goals[idx];
  goals.splice(idx, 1);
  persist();
  recordChangeEvent("org", goal.id, `Goalを削除しました: 「${goal.title}」`);
  return true;
}

export function toGoalView<T extends Goal>(goal: T): T {
  return {
    ...goal,
    title: unmaskNames(goal.title),
    ...(goal.note !== undefined ? { note: unmaskNames(goal.note) } : {}),
  };
}
