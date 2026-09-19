// Issue / Journal / Agent Run の UUID はエージェント出力などで先頭8桁だけ書かれることがある。
// ハイフン有無を正規化したプレフィックス照合と、自由文からの断片抽出を共有する。

export const ID_PREFIX_MIN_HEX = 8;

/** 比較用キー（小文字・ハイフン除去）。 */
export function normalizeIdKey(id: string): string {
  return id.trim().toLowerCase().replace(/-/g, "");
}

export function isHexIdPrefix(raw: string, minHex = ID_PREFIX_MIN_HEX): boolean {
  const key = normalizeIdKey(raw);
  return key.length >= minHex && /^[0-9a-f]+$/.test(key);
}

/** フル UUID（ハイフン付き）かどうか。 */
export function isFullUuid(raw: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw.trim());
}

export function idMatchesPrefix(fullId: string, prefix: string): boolean {
  const nId = normalizeIdKey(fullId);
  const nPrefix = normalizeIdKey(prefix);
  if (!nPrefix || !/^[0-9a-f]+$/.test(nPrefix)) return false;
  if (nPrefix.length < ID_PREFIX_MIN_HEX) return nId === nPrefix;
  return nId.startsWith(nPrefix);
}

export function findByIdPrefix<T>(items: readonly T[], getId: (item: T) => string, prefix: string): T[] {
  if (!isHexIdPrefix(prefix)) return [];
  return items.filter((item) => idMatchesPrefix(getId(item), prefix));
}

/**
 * 自由文中の UUID / 先頭8桁以上の hex 断片。
 * フル UUID 形式を優先し、連続 hex（8〜32）も拾う。
 */
export const ID_FRAGMENT_RE =
  /\b(?:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[0-9a-fA-F]{8,32})\b/g;

export type TextSegment = { type: "text" | "id"; value: string };

/** テキストを通常文と ID 断片に分割する（リンク化用）。 */
export function splitTextByIdFragments(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let last = 0;
  const re = new RegExp(ID_FRAGMENT_RE.source, "g");
  for (const match of text.matchAll(re)) {
    const value = match[0];
    const index = match.index ?? 0;
    if (index > last) segments.push({ type: "text", value: text.slice(last, index) });
    segments.push({ type: "id", value });
    last = index + value.length;
  }
  if (last < text.length) segments.push({ type: "text", value: text.slice(last) });
  if (segments.length === 0 && text) segments.push({ type: "text", value: text });
  return segments;
}

function isInsideMarkdownLink(text: string, index: number): boolean {
  // 既に [label](url) の url 側、または ]( の直後にいる場合は二重リンクを避ける
  const before = text.slice(Math.max(0, index - 3), index);
  if (before.endsWith("](")) return true;
  const from = text.lastIndexOf("](", index);
  if (from === -1) return false;
  const close = text.indexOf(")", from + 2);
  return close === -1 || close >= index;
}

/**
 * Markdown 本文の ID 断片を `/go/<fragment>` へのリンクにする。
 * コードフェンス内・既存リンクの URL 内は触らない。
 */
export function linkifyIdFragmentsInMarkdown(text: string): string {
  const parts: string[] = [];
  const fenceRe = /(```[\s\S]*?```|`[^`\n]+`)/g;
  let last = 0;
  for (const match of text.matchAll(fenceRe)) {
    const index = match.index ?? 0;
    if (index > last) parts.push(linkifyIdFragmentsInPlainMarkdown(text.slice(last, index)));
    parts.push(match[0]);
    last = index + match[0].length;
  }
  if (last < text.length) parts.push(linkifyIdFragmentsInPlainMarkdown(text.slice(last)));
  return parts.join("");
}

function linkifyIdFragmentsInPlainMarkdown(text: string): string {
  return text.replace(new RegExp(ID_FRAGMENT_RE.source, "g"), (match, offset: number) => {
    if (isInsideMarkdownLink(text, offset)) return match;
    return `[${match}](/go/${encodeURIComponent(match)})`;
  });
}

export function goHrefForIdFragment(fragment: string): string {
  return `/go/${encodeURIComponent(fragment)}`;
}
