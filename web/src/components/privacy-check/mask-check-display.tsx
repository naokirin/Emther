import type { ReactNode } from "react";

/** クライアント表示用（サーバー実装 `@/lib/mask-check` と揃える） */
export type SensitiveCategory =
  | "email"
  | "phone"
  | "url_secret"
  | "api_key_like"
  | "address"
  | "date_of_birth"
  | "identifier"
  | "organization"
  | "health"
  | "compensation"
  | "credential_mention"
  | "customer_or_contract"
  | "other_sensitive";

export type TextHighlightKind = SensitiveCategory | "name_candidate";

export type SensitiveFinding = {
  category: SensitiveCategory;
  excerpt: string;
  match: string;
  start?: number;
  end?: number;
  source: "rule" | "local-ai";
};

export type TextHighlight = {
  start: number;
  end: number;
  kind: TextHighlightKind;
  match: string;
};

export type NameMaskReplacement = { from: string; to: string; count: number };

export const CATEGORY_LABEL: Record<SensitiveCategory, string> = {
  email: "メールアドレス",
  phone: "電話番号っぽい",
  url_secret: "URL内の秘密っぽい値",
  api_key_like: "APIキーっぽい",
  address: "住所っぽい",
  date_of_birth: "生年月日っぽい",
  identifier: "ID・顧客番号っぽい",
  organization: "企業・組織名っぽい",
  health: "健康・体調",
  compensation: "給与・評価",
  credential_mention: "認証情報の言及",
  customer_or_contract: "顧客・契約",
  other_sensitive: "その他の機微っぽいもの",
};

export const HIGHLIGHT_LABEL: Record<TextHighlightKind, string> = {
  ...CATEGORY_LABEL,
  name_candidate: "人名っぽい語句",
};

/** カテゴリ別の背景色（問題箇所が一目で分かるように） */
export const HIGHLIGHT_STYLE: Record<TextHighlightKind, { background: string; color: string }> = {
  email: { background: "rgba(180, 83, 9, 0.28)", color: "inherit" },
  phone: { background: "rgba(180, 83, 9, 0.28)", color: "inherit" },
  url_secret: { background: "rgba(185, 28, 28, 0.28)", color: "inherit" },
  api_key_like: { background: "rgba(185, 28, 28, 0.28)", color: "inherit" },
  address: { background: "rgba(180, 83, 9, 0.22)", color: "inherit" },
  date_of_birth: { background: "rgba(180, 83, 9, 0.22)", color: "inherit" },
  identifier: { background: "rgba(194, 65, 12, 0.28)", color: "inherit" },
  organization: { background: "rgba(37, 99, 235, 0.28)", color: "inherit" },
  credential_mention: { background: "rgba(194, 65, 12, 0.32)", color: "inherit" },
  other_sensitive: { background: "rgba(153, 27, 27, 0.28)", color: "inherit" },
  health: { background: "rgba(13, 148, 136, 0.28)", color: "inherit" },
  compensation: { background: "rgba(124, 58, 237, 0.22)", color: "inherit" },
  customer_or_contract: { background: "rgba(37, 99, 235, 0.22)", color: "inherit" },
  name_candidate: { background: "rgba(202, 138, 4, 0.35)", color: "inherit" },
};

export const SOURCE_LABEL = {
  rule: "ルール",
  "local-ai": "ローカルAI",
} as const;

export type QuickPayload = {
  phase: "quick";
  sourceText: string;
  maskedText: string;
  nameReplacements: NameMaskReplacement[];
  unregisteredNameCandidates: string[];
  sensitiveFindings: SensitiveFinding[];
  highlights: TextHighlight[];
  truncated: boolean;
  inputCharCount: number;
  disclaimer: string;
};

export type AiPayload = {
  phase: "ai";
  unregisteredNameCandidates: string[];
  sensitiveFindings: SensitiveFinding[];
  highlights: TextHighlight[];
  aiScopeNote: string;
  aiWeak?: boolean;
  disclaimer: string;
};

export function mergeFindings(a: SensitiveFinding[], b: SensitiveFinding[]): SensitiveFinding[] {
  const seen = new Set(a.map((f) => `${f.category}:${f.match}:${f.start ?? ""}:${f.source}`));
  const out = [...a];
  for (const f of b) {
    const key = `${f.category}:${f.match}:${f.start ?? ""}:${f.source}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}

export function mergeNames(a: string[], b: string[]): string[] {
  const out = [...a];
  for (const n of b) {
    if (!out.includes(n)) out.push(n);
  }
  return out;
}

export function mergeHighlights(a: TextHighlight[], b: TextHighlight[]): TextHighlight[] {
  const all = [...a, ...b].sort((x, y) => y.end - y.start - (x.end - x.start) || x.start - y.start);
  const accepted: TextHighlight[] = [];
  for (const h of all) {
    const overlaps = accepted.some((x) => !(h.end <= x.start || h.start >= x.end));
    if (overlaps) continue;
    accepted.push(h);
  }
  return accepted.sort((x, y) => x.start - y.start);
}

export function renderHighlightedText(text: string, highlights: TextHighlight[]): ReactNode[] {
  if (!text) return [];
  const sorted = [...highlights].sort((a, b) => a.start - b.start);
  const nodes: ReactNode[] = [];
  let cursor = 0;
  sorted.forEach((h, i) => {
    if (h.start < cursor || h.end > text.length || h.start >= h.end) return;
    if (h.start > cursor) {
      nodes.push(<span key={`t-${cursor}`}>{text.slice(cursor, h.start)}</span>);
    }
    const style = HIGHLIGHT_STYLE[h.kind] ?? HIGHLIGHT_STYLE.other_sensitive;
    nodes.push(
      <mark
        key={`h-${h.start}-${i}`}
        title={HIGHLIGHT_LABEL[h.kind]}
        style={{
          background: style.background,
          color: style.color,
          padding: "0 1px",
          borderRadius: 2,
        }}
      >
        {text.slice(h.start, h.end)}
      </mark>,
    );
    cursor = h.end;
  });
  if (cursor < text.length) {
    nodes.push(<span key={`t-end`}>{text.slice(cursor)}</span>);
  }
  return nodes;
}

export function renderExcerptWithMatch(excerpt: string, match: string, kind: SensitiveCategory): ReactNode {
  if (!match || !excerpt.includes(match)) return excerpt;
  const idx = excerpt.indexOf(match);
  const style = HIGHLIGHT_STYLE[kind];
  return (
    <>
      {excerpt.slice(0, idx)}
      <mark
        style={{
          background: style.background,
          color: style.color,
          padding: "0 1px",
          borderRadius: 2,
          fontWeight: 600,
        }}
      >
        {match}
      </mark>
      {excerpt.slice(idx + match.length)}
    </>
  );
}

export const textBlockStyle = {
  whiteSpace: "pre-wrap" as const,
  wordBreak: "break-word" as const,
  fontSize: "0.875rem",
  margin: 0,
  padding: 12,
  background: "var(--surface-2, rgba(0,0,0,0.04))",
  borderRadius: 6,
  maxHeight: 360,
  overflow: "auto" as const,
  fontFamily: "inherit",
  lineHeight: 1.55,
};
