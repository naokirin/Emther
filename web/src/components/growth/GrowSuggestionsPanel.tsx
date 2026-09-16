"use client";

import { useState } from "react";
import styles from "@/app/page.module.css";
import { useGrowSuggestions } from "@/lib/hooks";
import type { GrowSuggestion } from "@/lib/types";

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric" });
}

// ユーザー要望「参考文献やWeb記事、書籍のリンクを乗せてほしい」対応。AIが実在を確信できる
// URLを付けた場合はそれを使い、無い場合（=ハルシネーション回避で意図的に省略された場合）は
// トピック名からの検索リンクへフォールバックする（どちらの場合もクリックできる状態にする）。
function searchUrlFor(topic: string, note?: string): string {
  const query = note ? `${topic} ${note}` : topic;
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

// extractGrowSuggestions側で http(s) 形式は検証済みだが、表示直前にも防御的に再確認する
// （javascript: 等の不正なスキームをうっかりレンダリングしない最後の砦）。
function isSafeHttpUrl(url: string | undefined): url is string {
  return !!url && /^https?:\/\/\S+$/i.test(url);
}

// docs/2nd_pivot_version.md Phase 8。pivot_policy.mdの5番目のAI役割「Grow」（EM自身の
// 学びの提示）。組織の観測・解釈とEM自身の振り返りを横断した学びの材料を、評価ではなく
// 判断材料として提示する。「確認済み」「見送る」は評価ではなく軽量な既読管理。
export function GrowSuggestionsPanel() {
  const { growSuggestions, setGrowSuggestions, growSuggestionsLoaded, refreshGrowSuggestions } = useGrowSuggestions();
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [statusUpdatingId, setStatusUpdatingId] = useState<string | null>(null);
  const [showDismissed, setShowDismissed] = useState(false);

  const dismissedCount = growSuggestions.filter((s) => s.status === "dismissed").length;
  const visible = growSuggestions
    .filter((s) => showDismissed || s.status !== "dismissed")
    .sort((a, b) => b.generatedAt - a.generatedAt);

  async function handleGenerate() {
    setGenerating(true);
    setGenerateError(null);
    try {
      const res = await fetch("/api/growth/generate", { method: "POST" });
      const data = await res.json().catch(() => null);
      if (res.status === 202) {
        // 人名の未確認確認待ちでparkされた。確認自体は別画面（Inbox）で行う。
        return;
      }
      if (!res.ok) throw new Error(data?.error ?? "学びの提案の生成に失敗しました");
      await refreshGrowSuggestions();
    } catch (err) {
      setGenerateError((err as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  async function handleSetStatus(suggestion: GrowSuggestion, status: GrowSuggestion["status"]) {
    setStatusUpdatingId(suggestion.id);
    try {
      const res = await fetch(`/api/growth/suggestions/${suggestion.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.suggestion) return;
      setGrowSuggestions(growSuggestions.map((s) => (s.id === suggestion.id ? data.suggestion : s)));
    } finally {
      setStatusUpdatingId(null);
    }
  }

  return (
    <div className={styles.panel}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <h2 style={{ margin: 0 }}>🌱 AIからの学びの提案</h2>
          <p className={styles.subtitle} style={{ marginTop: 4 }}>
            組織の観測・解釈とEM自身の振り返りを横断して、参考になりそうな学びの材料を示します（「これを学ぶべき」という評価・断定ではありません）。
          </p>
        </div>
        <button className={styles.btnOutline} disabled={generating} onClick={handleGenerate}>
          {generating ? "生成中…" : "🌱 今すぐ生成する"}
        </button>
      </div>
      {generateError && (
        <p className={styles.errorText} role="alert">
          {generateError}
        </p>
      )}
      {visible.length === 0 ? (
        <p className={styles.subtitle} style={{ marginTop: 10 }}>
          {!growSuggestionsLoaded
            ? "読み込み中…"
            : "まだ学びの提案はありません。週次バッチ（設定で変更可）か「今すぐ生成する」で作成できます。"}
        </p>
      ) : (
        visible.map((s) => (
          <div
            key={s.id}
            style={{
              marginTop: 12,
              paddingTop: 12,
              borderTop: "1px solid var(--border)",
              opacity: s.status === "dismissed" ? 0.6 : 1,
            }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
              <strong style={{ fontSize: "0.9375rem" }}>{s.title}</strong>
              {s.status === "unread" && (
                <span style={{ fontSize: "0.6875rem", color: "var(--accent, #2563eb)", whiteSpace: "nowrap" }}>未確認</span>
              )}
            </div>
            <p style={{ margin: "6px 0 0", fontSize: "0.9375rem", color: "var(--text-muted)" }}>{s.rationale}</p>
            {s.evidenceSummary && (
              <p style={{ margin: "6px 0 0", fontSize: "0.8125rem" }}>
                <strong>根拠: </strong>
                {s.evidenceSummary}
              </p>
            )}
            {s.references.length > 0 && (
              <ul style={{ margin: "6px 0 0 16px", fontSize: "0.8125rem" }}>
                {s.references.map((r, i) => {
                  const hasDirectUrl = isSafeHttpUrl(r.url);
                  const href = hasDirectUrl ? r.url : searchUrlFor(r.topic, r.note);
                  return (
                    <li key={i}>
                      <a href={href} target="_blank" rel="noreferrer noopener">
                        {r.topic}
                      </a>
                      {!hasDirectUrl && (
                        <span style={{ marginLeft: 6, fontSize: "0.6875rem", color: "var(--text-muted)" }}>
                          （🔍 検索）
                        </span>
                      )}
                      {r.isPrimarySource && (
                        <span style={{ marginLeft: 6, fontSize: "0.6875rem", color: "var(--text-muted)" }}>【原典】</span>
                      )}
                      {r.note && <span style={{ color: "var(--text-muted)" }}> — {r.note}</span>}
                    </li>
                  );
                })}
              </ul>
            )}
            <p className={styles.subtitle} style={{ marginTop: 6, fontSize: "0.75rem" }}>
              {formatDate(s.generatedAt)}
            </p>
            <div className={styles.yieldActions} style={{ marginTop: 6 }}>
              {s.status !== "acknowledged" && (
                <button
                  className={styles.btnOutline}
                  disabled={statusUpdatingId === s.id}
                  onClick={() => handleSetStatus(s, "acknowledged")}
                >
                  確認済みにする
                </button>
              )}
              {s.status !== "dismissed" && (
                <button
                  className={styles.btnOutline}
                  disabled={statusUpdatingId === s.id}
                  onClick={() => handleSetStatus(s, "dismissed")}
                >
                  今回は見送る
                </button>
              )}
            </div>
          </div>
        ))
      )}
      {dismissedCount > 0 && (
        <button
          type="button"
          className={`${styles.detailToggle} ${styles.detailToggleButton}`}
          style={{ marginTop: 12 }}
          onClick={() => setShowDismissed(!showDismissed)}
        >
          {showDismissed ? "見送った提案を隠す" : `見送った提案を見る（${dismissedCount}）`}
        </button>
      )}
    </div>
  );
}
