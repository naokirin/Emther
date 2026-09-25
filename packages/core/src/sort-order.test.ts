import { describe, expect, it } from "vitest";
import {
  applyReorderByIds,
  compareBySortOrder,
  ensureSortOrders,
  mergeSubsequenceOrder,
  nextSortOrder,
} from "./sort-order";

describe("sort-order", () => {
  it("compareBySortOrder は昇順、同値は updatedAt 降順", () => {
    const items = [
      { sortOrder: 1, updatedAt: 10 },
      { sortOrder: 0, updatedAt: 5 },
      { sortOrder: 1, updatedAt: 20 },
    ];
    expect([...items].sort(compareBySortOrder)).toEqual([
      { sortOrder: 0, updatedAt: 5 },
      { sortOrder: 1, updatedAt: 20 },
      { sortOrder: 1, updatedAt: 10 },
    ]);
  });

  it("ensureSortOrders は欠損時だけ採番する", () => {
    const items: { id: string; updatedAt: number; sortOrder?: number }[] = [
      { id: "a", updatedAt: 30 },
      { id: "b", updatedAt: 10 },
      { id: "c", updatedAt: 20 },
    ];
    expect(ensureSortOrders(items)).toBe(true);
    expect(items.map((i) => ({ id: i.id, sortOrder: i.sortOrder }))).toEqual([
      { id: "a", sortOrder: 0 },
      { id: "b", sortOrder: 2 },
      { id: "c", sortOrder: 1 },
    ]);
    expect(ensureSortOrders(items)).toBe(false);
  });

  it("nextSortOrder は max+1", () => {
    expect(nextSortOrder([])).toBe(0);
    expect(nextSortOrder([{ sortOrder: 0 }, { sortOrder: 3 }])).toBe(4);
  });

  it("mergeSubsequenceOrder は可視列の相対順だけ差し替える", () => {
    expect(mergeSubsequenceOrder(["a", "b", "c", "d"], ["c", "b"])).toEqual(["a", "c", "b", "d"]);
  });

  it("applyReorderByIds は全件並びを要求する", () => {
    const items = [
      { id: "a", sortOrder: 0 },
      { id: "b", sortOrder: 1 },
      { id: "c", sortOrder: 2 },
    ];
    applyReorderByIds(items, ["c", "a", "b"]);
    expect(items.map((i) => ({ id: i.id, sortOrder: i.sortOrder }))).toEqual([
      { id: "a", sortOrder: 1 },
      { id: "b", sortOrder: 2 },
      { id: "c", sortOrder: 0 },
    ]);
    expect(() => applyReorderByIds(items, ["a", "b"])).toThrow(/全件/);
    expect(() => applyReorderByIds(items, ["a", "b", "x"])).toThrow(/unknown/);
  });
});
