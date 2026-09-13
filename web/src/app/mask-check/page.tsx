"use client";

import { useMemo, useState, type ReactNode } from "react";
import styles from "@/app/page.module.css";
import { PageTitleRow } from "@/components/HelpLink";

/** クライアント表示用（サーバー実装 `@/lib/mask-check` と揃える） */
type SensitiveCategory =
  | "email"
  | "phone"
  | "url_secret"
  | "api_key_like"
  | "health"
  | "compensation"
  | "credential_mention"
  | "customer_or_contract"
  | "other_sensitive";

type TextHighlightKind = SensitiveCategory | "name_candidate";

type SensitiveFinding = {
  category: SensitiveCategory;
  excerpt: string;
  match: string;
  start?: number;
  end?: number;
  source: "rule" | "local-ai";
};

type TextHighlight = {
  start: number;
  end: number;
  kind: TextHighlightKind;
  match: string;
};

type NameMaskReplacement = { from: string; to: string; count: number };

const CATEGORY_LABEL: Record<SensitiveCategory, string> = {
  email: "メールアドレス",
  phone: "電話番号っぽい",
  url_secret: "URL内の秘密っぽい値",
  api_key_like: "APIキーっぽい",
  health: "健康・体調",
  compensation: "給与・評価",
  credential_mention: "認証情報の言及",
  customer_or_contract: "顧客・契約",
  other_sensitive: "その他の機微っぽいもの",
};

const HIGHLIGHT_LABEL: Record<TextHighlightKind, string> = {
  ...CATEGORY_LABEL,
  name_candidate: "人名っぽい語句",
};

/** カテゴリ別の背景色（問題箇所が一目で分かるように） */
const HIGHLIGHT_STYLE: Record<TextHighlightKind, { background: string; color: string }> = {
  email: { background: "rgba(180, 83, 9, 0.28)", color: "inherit" },
  phone: { background: "rgba(180, 83, 9, 0.28)", color: "inherit" },
  url_secret: { background: "rgba(185, 28, 28, 0.28)", color: "inherit" },
  api_key_like: { background: "rgba(185, 28, 28, 0.28)", color: "inherit" },
  credential_mention: { background: "rgba(194, 65, 12, 0.32)", color: "inherit" },
  other_sensitive: { background: "rgba(153, 27, 27, 0.28)", color: "inherit" },
  health: { background: "rgba(13, 148, 136, 0.28)", color: "inherit" },
  compensation: { background: "rgba(124, 58, 237, 0.22)", color: "inherit" },
  customer_or_contract: { background: "rgba(37, 99, 235, 0.22)", color: "inherit" },
  name_candidate: { background: "rgba(202, 138, 4, 0.35)", color: "inherit" },
};

const SOURCE_LABEL = {
  rule: "ルール",
  "local-ai": "ローカルAI",
} as const;

type QuickPayload = {
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

type AiPayload = {
  phase: "ai";
  unregisteredNameCandidates: string[];
  sensitiveFindings: SensitiveFinding[];
  highlights: TextHighlight[];
  aiScopeNote: string;
  aiWeak?: boolean;
  disclaimer: string;
};

function mergeFindings(a: SensitiveFinding[], b: SensitiveFinding[]): SensitiveFinding[] {
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

function mergeNames(a: string[], b: string[]): string[] {
  const out = [...a];
  for (const n of b) {
    if (!out.includes(n)) out.push(n);
  }
  return out;
}

function mergeHighlights(a: TextHighlight[], b: TextHighlight[]): TextHighlight[] {
  const all = [...a, ...b].sort((x, y) => y.end - y.start - (x.end - x.start) || x.start - y.start);
  const accepted: TextHighlight[] = [];
  for (const h of all) {
    const overlaps = accepted.some((x) => !(h.end <= x.start || h.start >= x.end));
    if (overlaps) continue;
    accepted.push(h);
  }
  return accepted.sort((x, y) => x.start - y.start);
}

function renderHighlightedText(text: string, highlights: TextHighlight[]): ReactNode[] {
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

function renderExcerptWithMatch(excerpt: string, match: string, kind: SensitiveCategory): ReactNode {
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

const textBlockStyle = {
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

export default function PrivacyCheckPage() {
  const [text, setText] = useState("");
  const [busyQuick, setBusyQuick] = useState(false);
  const [busyAi, setBusyAi] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [disclaimer, setDisclaimer] = useState<string | null>(null);
  const [sourceText, setSourceText] = useState<string | null>(null);
  const [maskedText, setMaskedText] = useState<string | null>(null);
  const [replacements, setReplacements] = useState<NameMaskReplacement[]>([]);
  const [findings, setFindings] = useState<SensitiveFinding[]>([]);
  const [highlights, setHighlights] = useState<TextHighlight[]>([]);
  const [unregistered, setUnregistered] = useState<string[]>([]);
  const [aiScopeNote, setAiScopeNote] = useState<string | null>(null);
  const [truncatedNote, setTruncatedNote] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function runCheck(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;

    setError(null);
    setBusyQuick(true);
    setBusyAi(false);
    setSourceText(null);
    setMaskedText(null);
    setReplacements([]);
    setFindings([]);
    setHighlights([]);
    setUnregistered([]);
    setAiScopeNote(null);
    setTruncatedNote(null);
    setCopied(false);

    try {
      const quickRes = await fetch("/api/mask-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: trimmed, phase: "quick" }),
      });
      const quickData = (await quickRes.json().catch(() => null)) as QuickPayload | { error?: string } | null;
      if (!quickRes.ok || !quickData || !("maskedText" in quickData)) {
        setError((quickData && "error" in quickData && quickData.error) || "チェックに失敗しました");
        setBusyQuick(false);
        return;
      }

      setSourceText(quickData.sourceText);
      setMaskedText(quickData.maskedText);
      setReplacements(quickData.nameReplacements);
      setFindings(quickData.sensitiveFindings);
      setHighlights(quickData.highlights ?? []);
      setUnregistered(quickData.unregisteredNameCandidates ?? []);
      setDisclaimer(quickData.disclaimer);
      if (quickData.truncated) {
        setTruncatedNote(
          `入力が長いため先頭のみ処理しました（${quickData.inputCharCount.toLocaleString()} 文字）。`,
        );
      }
      setBusyQuick(false);

      setBusyAi(true);
      try {
        const aiRes = await fetch("/api/mask-check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: trimmed, phase: "ai" }),
        });
        const aiData = (await aiRes.json().catch(() => null)) as AiPayload | { error?: string } | null;
        if (aiRes.ok && aiData && "sensitiveFindings" in aiData) {
          setFindings((prev) => mergeFindings(prev, aiData.sensitiveFindings));
          setUnregistered((prev) => mergeNames(prev, aiData.unregisteredNameCandidates));
          setHighlights((prev) => mergeHighlights(prev, aiData.highlights ?? []));
          setAiScopeNote(aiData.aiScopeNote);
          setDisclaimer(aiData.disclaimer);
        }
      } finally {
        setBusyAi(false);
      }
    } catch {
      setError("チェックに失敗しました");
      setBusyQuick(false);
      setBusyAi(false);
    }
  }

  async function copyMasked() {
    if (!maskedText) return;
    try {
      await navigator.clipboard.writeText(maskedText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  const hasResult = maskedText !== null;
  const legendKinds = useMemo(() => {
    const set = new Set<TextHighlightKind>();
    for (const h of highlights) set.add(h.kind);
    return [...set];
  }, [highlights]);

  return (
    <div className={styles.panel}>
      <PageTitleRow title="個人・機密情報チェック" helpAnchor="privacy-check" />
      <p style={{ fontSize: "0.875rem", color: "var(--muted)", marginTop: 0 }}>
        投入や外部送信の前に、登録済み人名のマスク結果と、個人情報・機密情報っぽい箇所をローカルだけで確認できます。
        この画面からは保存・送信・データ投入は行いません。
      </p>

      <form onSubmit={runCheck}>
        <div className={styles.field}>
          <label>
            確認したいテキスト
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={10}
              placeholder="例: 会議メモや Slack の抜粋、自分で書いていない長文など"
              disabled={busyQuick || busyAi}
            />
          </label>
        </div>
        <button
          className={styles.primaryBtn}
          type="submit"
          disabled={busyQuick || busyAi || !text.trim()}
        >
          {busyQuick ? "マスク確認中…" : busyAi ? "ローカルAIで追加確認中…" : "チェックする"}
        </button>
      </form>

      {error && (
        <p className={styles.errorText} role="alert">
          {error}
        </p>
      )}

      {hasResult && (
        <div style={{ marginTop: 24, display: "grid", gap: 20 }}>
          {disclaimer && (
            <p
              style={{
                fontSize: "0.8125rem",
                margin: 0,
                padding: "10px 12px",
                background: "var(--surface-2, rgba(0,0,0,0.04))",
                borderRadius: 6,
                lineHeight: 1.5,
              }}
            >
              {disclaimer}
            </p>
          )}
          {truncatedNote && (
            <p className={styles.errorText} style={{ margin: 0 }}>
              {truncatedNote}
            </p>
          )}
          {busyAi && (
            <p style={{ fontSize: "0.8125rem", color: "var(--muted)", margin: 0 }}>
              ローカルAIで機微っぽい箇所を追加確認しています…
            </p>
          )}
          {aiScopeNote && !busyAi && (
            <p style={{ fontSize: "0.8125rem", color: "var(--muted)", margin: 0 }}>{aiScopeNote}</p>
          )}

          <section>
            <h3 style={{ margin: "0 0 8px", fontSize: "1rem" }}>検出ハイライト（原文）</h3>
            <p style={{ fontSize: "0.75rem", color: "var(--muted)", margin: "0 0 8px" }}>
              色付き箇所が「特に問題になりそう」と判定された部分です（推測・誤検知あり）。
            </p>
            {legendKinds.length > 0 && (
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 8,
                  marginBottom: 8,
                  fontSize: "0.75rem",
                }}
              >
                {legendKinds.map((kind) => (
                  <span
                    key={kind}
                    style={{
                      ...HIGHLIGHT_STYLE[kind],
                      padding: "2px 8px",
                      borderRadius: 4,
                    }}
                  >
                    {HIGHLIGHT_LABEL[kind]}
                  </span>
                ))}
              </div>
            )}
            <div style={textBlockStyle} role="region" aria-label="検出ハイライト付き原文">
              {sourceText && highlights.length > 0
                ? renderHighlightedText(sourceText, highlights)
                : sourceText || "（なし）"}
            </div>
          </section>

          <section>
            <div className={styles.detailHeader} style={{ marginBottom: 8 }}>
              <h3 style={{ margin: 0, fontSize: "1rem" }}>人名マスク後のテキスト</h3>
              <button type="button" className={styles.btnOutline} onClick={copyMasked}>
                {copied ? "コピーしました" : "コピー"}
              </button>
            </div>
            <pre style={textBlockStyle}>{maskedText}</pre>
          </section>

          <section>
            <h3 style={{ margin: "0 0 8px", fontSize: "1rem" }}>人名の置換一覧</h3>
            {replacements.length === 0 ? (
              <p style={{ fontSize: "0.8125rem", color: "var(--muted)", margin: 0 }}>
                登録済み人名の置換はありません（People に未登録の名前はマスクされません）。
              </p>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: "0.875rem" }}>
                {replacements.map((r) => (
                  <li key={`${r.from}->${r.to}`}>
                    <code>{r.from}</code> → <code>{r.to}</code>
                    {r.count > 1 ? `（${r.count}箇所）` : ""}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h3 style={{ margin: "0 0 8px", fontSize: "1rem" }}>未登録の人名っぽい語句</h3>
            {unregistered.length === 0 && busyAi ? (
              <p style={{ fontSize: "0.8125rem", color: "var(--muted)", margin: 0 }}>追加確認中…</p>
            ) : unregistered.length === 0 ? (
              <p style={{ fontSize: "0.8125rem", color: "var(--muted)", margin: 0 }}>
                人名っぽい候補は見つかりませんでした。
              </p>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: "0.875rem" }}>
                {unregistered.map((n) => (
                  <li key={n}>
                    <mark
                      style={{
                        ...HIGHLIGHT_STYLE.name_candidate,
                        padding: "0 4px",
                        borderRadius: 2,
                      }}
                    >
                      {n}
                    </mark>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h3 style={{ margin: "0 0 8px", fontSize: "1rem" }}>個人情報・機密情報っぽい箇所</h3>
            {findings.length === 0 && !busyAi ? (
              <p style={{ fontSize: "0.8125rem", color: "var(--muted)", margin: 0 }}>
                候補は見つかりませんでした。保証ではありません。
              </p>
            ) : findings.length === 0 && busyAi ? (
              <p style={{ fontSize: "0.8125rem", color: "var(--muted)", margin: 0 }}>
                ルールでは未検出。ローカルAIの結果を待っています…
              </p>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: "0.875rem", display: "grid", gap: 8 }}>
                {findings.map((f, i) => (
                  <li key={`${f.category}-${f.match}-${f.start ?? i}-${f.source}`}>
                    <strong>{CATEGORY_LABEL[f.category]}</strong>
                    <span style={{ color: "var(--muted)", marginLeft: 6 }}>
                      （{SOURCE_LABEL[f.source]}）
                    </span>
                    <div style={{ marginTop: 2 }}>
                      {renderExcerptWithMatch(f.excerpt, f.match || f.excerpt, f.category)}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
