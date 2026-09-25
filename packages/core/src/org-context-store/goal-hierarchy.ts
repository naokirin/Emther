import type { Goal } from "./goal-types";

/** Theme.goalIds と同型: trim・空除去・重複除去。 */
export function normalizeIdList(ids: string[] | undefined): string[] {
  if (!ids?.length) return [];
  return Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean)));
}

/** goalId を parentGoalIds に含む Goal の id 一覧（下位側の導出）。 */
export function childGoalIds(goalId: string, goals: ReadonlyArray<Pick<Goal, "id" | "parentGoalIds">>): string[] {
  return goals.filter((g) => g.parentGoalIds?.includes(goalId)).map((g) => g.id);
}

/**
 * childId の parentGoalIds を nextParentIds にしたとき閉路になるか。
 * nextParentIds から祖先を辿り childId 自身に戻れば true。
 */
export function wouldCreateGoalCycle(
  childId: string,
  nextParentIds: ReadonlyArray<string>,
  goals: ReadonlyArray<Pick<Goal, "id" | "parentGoalIds">>,
): boolean {
  if (nextParentIds.includes(childId)) return true;
  const byId = new Map(goals.map((g) => [g.id, g]));
  const visited = new Set<string>();
  const stack = [...nextParentIds];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (id === childId) return true;
    if (visited.has(id)) continue;
    visited.add(id);
    const node = byId.get(id);
    if (!node?.parentGoalIds?.length) continue;
    for (const pid of node.parentGoalIds) stack.push(pid);
  }
  return false;
}

/**
 * 存在する ID のみ残し、自己参照を除く。閉路は検出し throw。
 * 空配列なら undefined（未リンク）を返す。
 */
export function resolveParentGoalIds(
  childId: string,
  raw: string[] | undefined,
  goals: ReadonlyArray<Pick<Goal, "id" | "parentGoalIds">>,
): string[] | undefined {
  const known = new Set(goals.map((g) => g.id));
  const next = normalizeIdList(raw).filter((id) => id !== childId && known.has(id));
  if (wouldCreateGoalCycle(childId, next, goals)) {
    throw new Error("Goalの上下関係が循環しています");
  }
  return next.length > 0 ? next : undefined;
}

export type GoalForestNode<T extends Pick<Goal, "id" | "parentGoalIds">> = {
  goal: T;
  /** アクティブ集合内で親が2つ以上（多対多） */
  shared: boolean;
  children: GoalForestNode<T>[];
};

/**
 * 閉路なし前提で、スキャン用の森を組み立てる。
 * - ルート: アクティブ集合内に親がいない Goal
 * - 子は各親の下にネスト（共有子は親ごと重複表示）
 */
export function buildGoalForest<T extends Pick<Goal, "id" | "parentGoalIds">>(goals: ReadonlyArray<T>): GoalForestNode<T>[] {
  const known = new Set(goals.map((g) => g.id));

  function activeParents(goal: T): string[] {
    return (goal.parentGoalIds ?? []).filter((id) => known.has(id));
  }

  function buildUnder(parentId: string, ancestors: ReadonlySet<string>): GoalForestNode<T>[] {
    const kids = goals
      .filter((g) => (g.parentGoalIds ?? []).includes(parentId))
      .filter((g) => !ancestors.has(g.id));
    return kids.map((goal) => {
      const nextAncestors = new Set(ancestors);
      nextAncestors.add(goal.id);
      return {
        goal,
        shared: activeParents(goal).length > 1,
        children: buildUnder(goal.id, nextAncestors),
      };
    });
  }

  const roots = goals.filter((g) => activeParents(g).length === 0);
  // ルートが無い（全員が互いの子のみ等）場合はフラットに落とす
  if (roots.length === 0 && goals.length > 0) {
    return goals.map((goal) => ({
      goal,
      shared: activeParents(goal).length > 1,
      children: [],
    }));
  }

  return roots.map((goal) => ({
    goal,
    shared: false,
    children: buildUnder(goal.id, new Set([goal.id])),
  }));
}
