import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import styles from "../../styles/page.module.css";
import { growSuggestionsQueryKey, useGrowSuggestions, useRuns } from "../../lib/queries";
import { api, rpcInit } from "../../lib/api-client";
import type { GrowSuggestion } from "@emther/core/types";

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
//
// ユーザー指摘「生成中でもボタンがdisabledにならない／完了がわかりにくい」対応。
// POST /api/growth/generate は run 起動だけですぐ返るため、起動中フラグだけでは足りない。
// JournalDumpPanel と同様に runId を持ち、useRuns のポーリングで active/queued が終わるまで
// ボタンを止め、終了後に一覧を再取得して件数付きの完了メッセージを出す。
export function GrowSuggestionsPanel() {
  const { growSuggestions, growSuggestionsLoaded, refreshGrowSuggestions } = useGrowSuggestions();
  const queryClient = useQueryClient();
  const { runs, refreshRuns } = useRuns();
  const [starting, setStarting] = useState(false);
  const [pendingRunId, setPendingRunId] = useState<string | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [generateStatus, setGenerateStatus] = useState<string | null>(null);
  const [statusUpdatingId, setStatusUpdatingId] = useState<string | null>(null);
  const [showDismissed, setShowDismissed] = useState(false);
  // ユーザー要望「折りたたみにしてデフォルトは閉じ、ヘッダーと件数のみ見せたい」対応。
  // 一覧は情報量が多く画面を占有するため、必要なときだけ開く。
  const [expanded, setExpanded] = useState(false);
  // 同じ run の完了処理を二重に走らせない（runs ポーリングで status が何度も届くため）。
  const handledRunIdRef = useRef<string | null>(null);

  const pendingRun = pendingRunId ? (runs.find((r) => r.id === pendingRunId) ?? null) : null;
  const runBusy = pendingRun?.status === "active" || pendingRun?.status === "queued";
  // refreshRuns 反映前は runs にまだ無いので、その間も生成中扱いを続ける。
  const waitingForRunList = !!pendingRunId && !pendingRun;
  const generating = starting || waitingForRunList || !!runBusy;

  const dismissedCount = growSuggestions.filter((s) => s.status === "dismissed").length;
  // 折りたたみ時の件数は「見送ったものを除く」件数（既定の一覧と同じ母集団）。
  const activeCount = growSuggestions.filter((s) => s.status !== "dismissed").length;
  const visible = growSuggestions
    .filter((s) => showDismissed || s.status !== "dismissed")
    .sort((a, b) => b.generatedAt - a.generatedAt);

  useEffect(() => {
    if (!pendingRunId || !pendingRun) return;
    if (pendingRun.status === "active" || pendingRun.status === "queued") return;
    if (handledRunIdRef.current === pendingRunId) return;
    handledRunIdRef.current = pendingRunId;

    const finishedRunId = pendingRunId;
    const finishedStatus = pendingRun.status;

    void (async () => {
      const data = await refreshGrowSuggestions();
      const suggestions = (data as { suggestions?: GrowSuggestion[] } | null)?.suggestions ?? [];
      const fromRun = suggestions.filter((s) => s.sourceRunId === finishedRunId);

      if (finishedStatus === "idle") {
        setGenerateError(null);
        setGenerateStatus(
          fromRun.length > 0
            ? `${fromRun.length}件の学びの提案を追加しました。`
            : "生成は完了しましたが、新しい提案はありませんでした（材料が乏しい場合など）。",
        );
      } else if (finishedStatus === "yield") {
        setGenerateStatus(null);
        setGenerateError(
          "AIから追加の確認が必要という応答がありました。「何でも相談」または Inbox から続きを確認してください。",
        );
      } else {
        setGenerateStatus(null);
        setGenerateError("学びの提案の生成中にエラーが発生しました。Inbox からログを確認してください。");
      }
      setPendingRunId(null);
    })();
  }, [pendingRunId, pendingRun, refreshGrowSuggestions]);

  async function handleGenerate() {
    setStarting(true);
    setGenerateError(null);
    setGenerateStatus(null);
    handledRunIdRef.current = null;
    try {
      const res = await api.api.growth.generate.$post();
      const data = (await res.json().catch(() => null)) as { error?: string; run?: { id?: string } } | null;
      if (res.status === 202) {
        // 人名の未確認確認待ちでparkされた。確認自体は別画面（Inbox）で行う。
        setGenerateStatus("人名の確認待ちです。Inbox で確認すると生成が始まります。");
        return;
      }
      if (!res.ok) throw new Error(data?.error ?? "学びの提案の生成に失敗しました");
      const runId = data?.run?.id as string | undefined;
      if (!runId) throw new Error("生成の起動に失敗しました");
      setPendingRunId(runId);
      setGenerateStatus("学びの提案を生成しています…");
      await refreshRuns();
    } catch (err) {
      setGenerateError((err as Error).message);
      setGenerateStatus(null);
    } finally {
      setStarting(false);
    }
  }

  async function handleSetStatus(suggestion: GrowSuggestion, status: GrowSuggestion["status"]) {
    setStatusUpdatingId(suggestion.id);
    try {
      const res = await api.api.growth.suggestions[":id"].$patch(rpcInit({
        param: { id: suggestion.id },
        json: { status },
      }));
      const data = (await res.json().catch(() => null)) as { suggestion?: GrowSuggestion } | null;
      if (!res.ok || !data?.suggestion) return;
      const updated = data.suggestion;
      queryClient.setQueryData<{ suggestions: GrowSuggestion[] }>(growSuggestionsQueryKey, () => ({
        suggestions: growSuggestions.map((s) => (s.id === suggestion.id ? updated : s)),
      }));
    } finally {
      setStatusUpdatingId(null);
    }
  }

  return (
    <div className={styles.panel}>
      {/* NN/G・WebAIMのdisclosure慣習: 左シェブロン＋見出し全体がトグル＋「開く/閉じる」文言。
          ▸だけの控えめ表示では折りたたみと気づきにくい、という指摘への対応。 */}
      <button
        type="button"
        className={styles.disclosureToggle}
        aria-expanded={expanded}
        aria-controls="grow-suggestions-panel"
        onClick={() => setExpanded((v) => !v)}
      >
        <span className={styles.disclosureChevron} aria-hidden="true">
          <svg className={styles.disclosureChevronIcon} viewBox="0 0 12 12" focusable="false">
            <path d="M4.2 1.5 8.7 6l-4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <span className={styles.disclosureLabel}>
          <h2>🌱 AIからの学びの提案</h2>
        </span>
        <span className={styles.disclosureAside}>
          <span className={styles.disclosureCount}>{growSuggestionsLoaded ? `${activeCount}件` : "…"}</span>
          <span className={styles.disclosureAction}>{expanded ? "閉じる" : "開く"}</span>
        </span>
      </button>
      {expanded && (
        <div id="grow-suggestions-panel">
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginTop: 8 }}>
            <p className={styles.subtitle} style={{ margin: 0, minWidth: 0, flex: "1 1 12rem" }}>
              組織の観測・解釈とEM自身の振り返りを横断して、参考になりそうな学びの材料を示します（「これを学ぶべき」という評価・断定ではありません）。
            </p>
            <button className={styles.btnOutline} disabled={generating} onClick={handleGenerate}>
              {generating ? "生成中…" : "🌱 今すぐ生成する"}
            </button>
          </div>
          {generateStatus && (
            <p className={styles.subtitle} style={{ marginTop: 8 }} role="status" aria-live="polite">
              {generateStatus}
            </p>
          )}
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
      )}
    </div>
  );
}
