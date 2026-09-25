/** sortOrder 付きエンティティの安定ソート（昇順。同値時は updatedAt 降順）。 */
export function compareBySortOrder(
  a: { sortOrder: number; updatedAt: number },
  b: { sortOrder: number; updatedAt: number },
): number {
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  return b.updatedAt - a.updatedAt;
}

/** 既存データに sortOrder が無いとき、現状順（updatedAt 降順）で 0..n-1 を採番する。 */
export function ensureSortOrders<T extends { sortOrder?: number; updatedAt: number }>(
  items: T[],
): boolean {
  const missing = items.some((item) => typeof item.sortOrder !== "number");
  if (!missing) return false;
  const ranked = [...items].sort((a, b) => b.updatedAt - a.updatedAt);
  ranked.forEach((item, index) => {
    item.sortOrder = index;
  });
  return true;
}

export function nextSortOrder(items: { sortOrder: number }[]): number {
  if (items.length === 0) return 0;
  return Math.max(...items.map((item) => item.sortOrder)) + 1;
}

/**
 * 全件の ID 列に対し、表示中サブシーケンスの新しい相対順をマージする。
 * fullIds は現行の全並び、visibleOrderedIds は DnD 後の可視 ID 列。
 */
export function mergeSubsequenceOrder(fullIds: string[], visibleOrderedIds: string[]): string[] {
  const visibleSet = new Set(visibleOrderedIds);
  if (visibleSet.size !== visibleOrderedIds.length) {
    throw new Error("visibleOrderedIds に重複があります");
  }
  let cursor = 0;
  return fullIds.map((id) => {
    if (!visibleSet.has(id)) return id;
    const next = visibleOrderedIds[cursor];
    cursor += 1;
    return next;
  });
}

/**
 * ids を完全集合として sortOrder を 0..n-1 に振り直す。
 * 未知 ID・件数不一致はエラー。
 */
export function applyReorderByIds<T extends { id: string; sortOrder: number }>(
  items: T[],
  ids: string[],
): void {
  if (ids.length !== items.length || new Set(ids).size !== ids.length) {
    throw new Error("idsは全件の重複なし並びである必要があります");
  }
  const byId = new Map(items.map((item) => [item.id, item]));
  for (const id of ids) {
    if (!byId.has(id)) {
      throw new Error(`unknown id: ${id}`);
    }
  }
  ids.forEach((id, index) => {
    byId.get(id)!.sortOrder = index;
  });
}
