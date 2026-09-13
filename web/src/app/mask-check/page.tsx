"use client";

import { useState } from "react";
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

type SensitiveFinding = {
  category: SensitiveCategory;
  excerpt: string;
  source: "rule" | "local-ai";
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

const SOURCE_LABEL = {
  rule: "ルール",
  "local-ai": "ローカルAI",
} as const;

type QuickPayload = {
  phase: "quick";
  maskedText: string;
  nameReplacements: NameMaskReplacement[];
  sensitiveFindings: SensitiveFinding[];
  truncated: boolean;
  inputCharCount: number;
  disclaimer: string;
};

type AiPayload = {
  phase: "ai";
  unregisteredNameCandidates: string[];
  sensitiveFindings: SensitiveFinding[];
  aiScopeNote: string;
  disclaimer: string;
};

function mergeFindings(a: SensitiveFinding[], b: SensitiveFinding[]): SensitiveFinding[] {
  const seen = new Set(a.map((f) => `${f.category}:${f.excerpt}:${f.source}`));
  const out = [...a];
  for (const f of b) {
    const key = `${f.category}:${f.excerpt}:${f.source}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}

export default function PrivacyCheckPage() {
  const [text, setText] = useState("");
  const [busyQuick, setBusyQuick] = useState(false);
  const [busyAi, setBusyAi] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [disclaimer, setDisclaimer] = useState<string | null>(null);
  const [maskedText, setMaskedText] = useState<string | null>(null);
  const [replacements, setReplacements] = useState<NameMaskReplacement[]>([]);
  const [findings, setFindings] = useState<SensitiveFinding[]>([]);
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
    setMaskedText(null);
    setReplacements([]);
    setFindings([]);
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

      setMaskedText(quickData.maskedText);
      setReplacements(quickData.nameReplacements);
      setFindings(quickData.sensitiveFindings);
      setDisclaimer(quickData.disclaimer);
      if (quickData.truncated) {
        setTruncatedNote(
          `入力が長いため先頭のみ処理しました（${quickData.inputCharCount.toLocaleString()} 文字）。`,
        );
      }
      setBusyQuick(false);

      // 第2段: ローカル AI は基本常時実行（ボタン不要）
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
          setUnregistered(aiData.unregisteredNameCandidates);
          setAiScopeNote(aiData.aiScopeNote);
          setDisclaimer(aiData.disclaimer);
        }
        // AI 失敗時も quick 結果は残す
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
            <div className={styles.detailHeader} style={{ marginBottom: 8 }}>
              <h3 style={{ margin: 0, fontSize: "1rem" }}>人名マスク後のテキスト</h3>
              <button type="button" className={styles.btnOutline} onClick={copyMasked}>
                {copied ? "コピーしました" : "コピー"}
              </button>
            </div>
            <pre
              style={{
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                fontSize: "0.875rem",
                margin: 0,
                padding: 12,
                background: "var(--surface-2, rgba(0,0,0,0.04))",
                borderRadius: 6,
                maxHeight: 320,
                overflow: "auto",
              }}
            >
              {maskedText}
            </pre>
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
            {busyAi && unregistered.length === 0 ? (
              <p style={{ fontSize: "0.8125rem", color: "var(--muted)", margin: 0 }}>確認中…</p>
            ) : unregistered.length === 0 ? (
              <p style={{ fontSize: "0.8125rem", color: "var(--muted)", margin: 0 }}>
                見つかりませんでした（またはローカルAIが未検出）。
              </p>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: "0.875rem" }}>
                {unregistered.map((n) => (
                  <li key={n}>
                    <code>{n}</code>
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
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: "0.875rem", display: "grid", gap: 6 }}>
                {findings.map((f, i) => (
                  <li key={`${f.category}-${f.excerpt}-${f.source}-${i}`}>
                    <strong>{CATEGORY_LABEL[f.category]}</strong>
                    <span style={{ color: "var(--muted)", marginLeft: 6 }}>
                      （{SOURCE_LABEL[f.source]}）
                    </span>
                    <div style={{ marginTop: 2 }}>{f.excerpt}</div>
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
