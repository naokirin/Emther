import type { RethinkItem } from "./types";

export type { RethinkItem };

/** AI出力・旧 string[] を RethinkItem[] に正規化する。不正要素は落とす。 */
export function normalizeRethinkItems(parsed: unknown): RethinkItem[] {
  if (!Array.isArray(parsed)) return [];
  const out: RethinkItem[] = [];
  for (const entry of parsed) {
    if (typeof entry === "string" && entry.trim()) {
      out.push({ category: "", text: entry.trim() });
      continue;
    }
    if (!entry || typeof entry !== "object") continue;
    const raw = entry as { category?: unknown; text?: unknown; content?: unknown };
    const text =
      typeof raw.text === "string" && raw.text.trim()
        ? raw.text.trim()
        : typeof raw.content === "string" && raw.content.trim()
          ? raw.content.trim()
          : "";
    if (!text) continue;
    const category = typeof raw.category === "string" ? raw.category.trim() : "";
    out.push({ category, text });
  }
  return out;
}

export function formatRethinkItemLine(item: RethinkItem): string {
  return item.category ? `[${item.category}] ${item.text}` : item.text;
}

export function mapRethinkItemStrings(
  items: RethinkItem[],
  map: (s: string) => string,
): RethinkItem[] {
  return items.map((item) => ({
    category: map(item.category),
    text: map(item.text),
  }));
}
