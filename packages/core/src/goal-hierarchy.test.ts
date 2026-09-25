import { describe, expect, it, vi } from "vitest";
import {
  buildGoalForest,
  childGoalIds,
  normalizeIdList,
  resolveParentGoalIds,
  wouldCreateGoalCycle,
} from "./org-context-store/goal-hierarchy";
import type { Goal } from "./org-context-store/goal-types";
import type { GoalRepository } from "./org-context-store/goal-repository";
import { createGoalService } from "./org-context-store/goal-domain";

vi.mock("./knowledge-store", () => ({
  recordChangeEvent: vi.fn(),
}));

vi.mock("./people-directory", () => ({
  maskForStorage: vi.fn(async (text: string) => text),
  unmaskNames: (text: string) => text,
}));

function createMemoryGoalRepository(initial: Goal[] = []): GoalRepository {
  let stored = [...initial];
  return {
    load: () => [...stored],
    save: (goals) => {
      stored = [...goals];
    },
  };
}

function baseGoal(partial: Partial<Goal> & Pick<Goal, "id" | "title">): Goal {
  return {
    status: "active",
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  };
}

describe("goal-hierarchy helpers", () => {
  it("normalizeIdList は trim・空除去・重複除去する", () => {
    expect(normalizeIdList([" a ", "", "b", "a", "b "])).toEqual(["a", "b"]);
    expect(normalizeIdList(undefined)).toEqual([]);
  });

  it("childGoalIds は parentGoalIds から下位を導出する", () => {
    const goals = [
      baseGoal({ id: "p", title: "親" }),
      baseGoal({ id: "c1", title: "子1", parentGoalIds: ["p"] }),
      baseGoal({ id: "c2", title: "子2", parentGoalIds: ["p", "other"] }),
      baseGoal({ id: "x", title: "無関係" }),
    ];
    expect(childGoalIds("p", goals).sort()).toEqual(["c1", "c2"]);
  });

  it("自己参照と閉路を検出する", () => {
    const goals = [
      baseGoal({ id: "a", title: "A", parentGoalIds: ["b"] }),
      baseGoal({ id: "b", title: "B" }),
    ];
    expect(wouldCreateGoalCycle("a", ["a"], goals)).toBe(true);
    expect(wouldCreateGoalCycle("b", ["a"], goals)).toBe(true);
    expect(wouldCreateGoalCycle("b", [], goals)).toBe(false);
  });

  it("resolveParentGoalIds は未知ID・自己参照を落とし閉路は throw", () => {
    const goals = [
      baseGoal({ id: "a", title: "A" }),
      baseGoal({ id: "b", title: "B" }),
    ];
    expect(resolveParentGoalIds("a", ["b", "b", "missing", "a"], goals)).toEqual(["b"]);
    expect(resolveParentGoalIds("a", [], goals)).toBeUndefined();

    const linked = [
      baseGoal({ id: "a", title: "A", parentGoalIds: ["b"] }),
      baseGoal({ id: "b", title: "B" }),
    ];
    expect(() => resolveParentGoalIds("b", ["a"], linked)).toThrow(/循環/);
  });

  it("buildGoalForest はルート列＋子ネスト（共有子は親ごと重複）", () => {
    const goals = [
      baseGoal({ id: "p1", title: "P1" }),
      baseGoal({ id: "p2", title: "P2" }),
      baseGoal({ id: "c", title: "C", parentGoalIds: ["p1", "p2"] }),
      baseGoal({ id: "leaf", title: "L", parentGoalIds: ["c"] }),
    ];
    const forest = buildGoalForest(goals);
    expect(forest.map((n) => n.goal.id).sort()).toEqual(["p1", "p2"]);
    const underP1 = forest.find((n) => n.goal.id === "p1")!;
    expect(underP1.children).toHaveLength(1);
    expect(underP1.children[0]!.goal.id).toBe("c");
    expect(underP1.children[0]!.shared).toBe(true);
    expect(underP1.children[0]!.children.map((n) => n.goal.id)).toEqual(["leaf"]);
    const underP2 = forest.find((n) => n.goal.id === "p2")!;
    expect(underP2.children[0]!.goal.id).toBe("c");
    expect(underP2.children[0]!.shared).toBe(true);
  });
});

describe("goal-domain parentGoalIds", () => {
  it("作成時に parentGoalIds を保存し、多対多の下位導出ができる", async () => {
    const service = createGoalService(createMemoryGoalRepository());
    const parent = await service.addGoal({ title: "組織目標" });
    const child = await service.addGoal({ title: "チーム目標", parentGoalIds: [parent.id] });
    expect(child.parentGoalIds).toEqual([parent.id]);
    expect(childGoalIds(parent.id, service.listGoals())).toEqual([child.id]);
  });

  it("閉路になる更新は拒否する", async () => {
    const service = createGoalService(createMemoryGoalRepository());
    const a = await service.addGoal({ title: "A" });
    const b = await service.addGoal({ title: "B", parentGoalIds: [a.id] });
    await expect(service.updateGoal(a.id, { parentGoalIds: [b.id] })).rejects.toThrow(/循環/);
    expect(service.getGoal(a.id)?.parentGoalIds).toBeUndefined();
  });

  it("削除時に他 Goal の parentGoalIds から参照を掃除する", async () => {
    const service = createGoalService(createMemoryGoalRepository());
    const parent = await service.addGoal({ title: "親" });
    const child = await service.addGoal({ title: "子", parentGoalIds: [parent.id] });
    expect(service.removeGoal(parent.id)).toBe(true);
    expect(service.getGoal(child.id)?.parentGoalIds).toBeUndefined();
  });

  it("存在しない親IDは保存されない", async () => {
    const service = createGoalService(createMemoryGoalRepository());
    const goal = await service.addGoal({ title: "単独", parentGoalIds: ["no-such"] });
    expect(goal.parentGoalIds).toBeUndefined();
  });
});
