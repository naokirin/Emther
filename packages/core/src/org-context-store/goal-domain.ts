import { randomUUID } from "node:crypto";
import { recordChangeEvent } from "../knowledge-store";
import { maskForStorage, unmaskNames } from "../people-directory";
import {
  applyReorderByIds,
  compareBySortOrder,
  ensureSortOrders,
  nextSortOrder,
} from "../sort-order";
import type { GoalRepository } from "./goal-repository";
import type { Goal, GoalHorizon, GoalStatus } from "./goal-types";
import { resolveParentGoalIds } from "./goal-hierarchy";

function normalizeHorizon(value: unknown): GoalHorizon | undefined {
  return value === "long" || value === "mid" || value === "near" ? value : undefined;
}

function normalizeStatus(value: unknown): GoalStatus {
  return value === "achieved" || value === "abandoned" ? value : "active";
}

function sameIdList(a: string[] | undefined, b: string[] | undefined): boolean {
  const left = a ?? [];
  const right = b ?? [];
  if (left.length !== right.length) return false;
  const sortedRight = [...right].sort();
  return [...left].sort().every((id, i) => id === sortedRight[i]);
}

export function createGoalService(repo: GoalRepository) {
  const goals: Goal[] = [...repo.load()] as Goal[];
  if (ensureSortOrders(goals)) {
    repo.save(goals);
  }

  function persist(): void {
    repo.save(goals);
  }

  function listGoals(): Goal[] {
    return [...goals].sort(compareBySortOrder);
  }

  function listActiveGoals(): Goal[] {
    return listGoals().filter((g) => g.status === "active");
  }

  function getGoal(id: string): Goal | undefined {
    return goals.find((g) => g.id === id);
  }

  async function addGoal(input: {
    title: string;
    teamId?: string;
    elaboration?: string;
    note?: string;
    horizon?: GoalHorizon;
    parentGoalIds?: string[];
  }): Promise<Goal> {
    const title = input.title.trim();
    if (!title) {
      throw new Error("titleは必須です");
    }
    const now = Date.now();
    const elaboration = input.elaboration?.trim();
    const note = input.note?.trim();
    const id = randomUUID();
    // 新規 ID はまだ goals に無いので、検証用に仮エントリを足した一覧で親を解決する
    const parentGoalIds = resolveParentGoalIds(id, input.parentGoalIds, [
      ...goals,
      { id, parentGoalIds: undefined },
    ]);
    const goal: Goal = {
      id,
      title: await maskForStorage(title),
      ...(elaboration ? { elaboration: await maskForStorage(elaboration) } : {}),
      ...(note ? { note: await maskForStorage(note) } : {}),
      teamId: input.teamId,
      ...(parentGoalIds ? { parentGoalIds } : {}),
      horizon: normalizeHorizon(input.horizon),
      status: "active",
      sortOrder: nextSortOrder(goals),
      createdAt: now,
      updatedAt: now,
    };
    goals.push(goal);
    persist();
    recordChangeEvent("org", goal.id, `Goalを作成: 「${goal.title}」`);
    return goal;
  }

  async function updateGoal(
    id: string,
    patch: {
      title?: string;
      teamId?: string | null;
      elaboration?: string | null;
      note?: string | null;
      horizon?: GoalHorizon | null;
      status?: GoalStatus;
      parentGoalIds?: string[] | null;
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
    if (patch.elaboration !== undefined) {
      const next =
        patch.elaboration === null || !patch.elaboration.trim()
          ? undefined
          : await maskForStorage(patch.elaboration.trim());
      if (next !== goal.elaboration) {
        changes.push(next ? "補足を更新しました" : "補足を削除しました");
        if (next) goal.elaboration = next;
        else delete goal.elaboration;
      }
    }
    if (patch.note !== undefined) {
      const next = patch.note === null || !patch.note.trim() ? undefined : await maskForStorage(patch.note.trim());
      if (next !== goal.note) {
        changes.push(next ? "運用メモを更新しました" : "運用メモを削除しました");
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
    if (patch.parentGoalIds !== undefined) {
      const next = resolveParentGoalIds(
        id,
        patch.parentGoalIds === null ? [] : patch.parentGoalIds,
        goals,
      );
      if (!sameIdList(goal.parentGoalIds, next)) {
        changes.push(
          next?.length
            ? `上位Goalを更新しました（${next.length}件）`
            : "上位Goalの紐づけを解除しました",
        );
        if (next) goal.parentGoalIds = next;
        else delete goal.parentGoalIds;
      }
    }

    if (changes.length === 0) return goal;
    goal.updatedAt = Date.now();
    persist();
    recordChangeEvent("org", goal.id, changes.join(" / "));
    return goal;
  }

  function removeGoal(id: string): boolean {
    const idx = goals.findIndex((g) => g.id === id);
    if (idx === -1) return false;
    const goal = goals[idx];
    let cleaned = false;
    for (const other of goals) {
      if (!other.parentGoalIds?.includes(id)) continue;
      const next = other.parentGoalIds.filter((pid) => pid !== id);
      if (next.length > 0) other.parentGoalIds = next;
      else delete other.parentGoalIds;
      other.updatedAt = Date.now();
      cleaned = true;
    }
    goals.splice(idx, 1);
    persist();
    if (cleaned) {
      recordChangeEvent("org", goal.id, `Goal削除に伴い他Goalの上位リンクを掃除しました`);
    }
    recordChangeEvent("org", goal.id, `Goalを削除しました: 「${goal.title}」`);
    return true;
  }

  function reorderGoals(ids: string[]): Goal[] {
    applyReorderByIds(goals, ids);
    persist();
    return listGoals();
  }

  function toGoalView<T extends Goal>(goal: T): T {
    return {
      ...goal,
      title: unmaskNames(goal.title),
      ...(goal.elaboration !== undefined ? { elaboration: unmaskNames(goal.elaboration) } : {}),
      ...(goal.note !== undefined ? { note: unmaskNames(goal.note) } : {}),
    };
  }

  return {
    listGoals,
    listActiveGoals,
    getGoal,
    addGoal,
    updateGoal,
    removeGoal,
    reorderGoals,
    toGoalView,
  };
}
