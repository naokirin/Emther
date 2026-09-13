"use client";

import { useState } from "react";
import styles from "@/app/page.module.css";
import { consultListMetaParts } from "@/components/ConsultHistoryItem";
import type { AgentRun } from "@/components/RunDetail";
import { IssueStrategyLinkSuggestPanel } from "@/components/HierarchyLinkSuggestPanel";
import { consultListSecondary, consultListTitle, truncateExcerpt } from "@/lib/origin-trace";
import { ISSUE_PRIORITY_META, type IssueStrategyLinkSuggestion } from "@/lib/types";
import { LANE_META, rankActions, type ExecutionMove, type Lane, type NextAction } from "@/lib/dashboard-next-actions";

// 整備レーンの初期表示件数。判断待ち・観測不足は設定（decisionQueueLimit /
// observationQueueLimit）で変えられるが、整備は設定項目が無いため定数で揃える。
const MAINTENANCE_LANE_LIMIT = 3;
// 「もっと見る」を押すたびに追加で前面に出す件数。
const LANE_EXPAND_STEP = 3;
// UI/UX見直し（今日タブ）対応。「何をすべきか不明瞭」への対処として、単一のヒーロー＋
// 残り一覧ではなく「今日やるべき3つ」を明示する。
const TOP_ACTIONS_LIMIT = 3;
const INTERVENTION_NEXT_ACTION_LIMIT = 3;

/** 「今日やるべき3つ」「進める次の一手」の各カード先頭に付ける順位バッジ。 */
function RankBadge({ n }: { n: number }) {
  return (
    <span
      aria-hidden
      style={{
        flexShrink: 0,
        width: 26,
        height: 26,
        marginTop: 1,
        borderRadius: "50%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontWeight: 800,
        fontSize: "0.8125rem",
        background: "var(--panel)",
        border: "1px solid var(--border)",
      }}
    >
      {n}
    </span>
  );
}

type Props = {
  now: number;
  nextActions: NextAction[];
  executionMoves: ExecutionMove[];
  nextActionsLoaded: boolean;
  issuesLoaded: boolean;
  decisionQueueLimit: number;
  observationQueueLimit: number;
  watchingItems: AgentRun[];
  lastSeenAt: number | null;
  unlinkedParentCount: number;
  krTotals: { done: number; total: number };
  autoRunsToday: number;
  handMode: "decide" | "execute";
  onHandModeChange: (mode: "decide" | "execute") => void;
  onNavigate: (path: string) => void;
  refreshIssues: () => Promise<void>;
};

export function TodayActionsPanel({
  now,
  nextActions,
  executionMoves,
  nextActionsLoaded,
  issuesLoaded,
  decisionQueueLimit,
  observationQueueLimit,
  watchingItems,
  lastSeenAt,
  unlinkedParentCount,
  krTotals,
  autoRunsToday,
  handMode,
  onHandModeChange,
  onNavigate,
  refreshIssues,
}: Props) {
  const [laneFilter, setLaneFilter] = useState<Lane>("decision");
  const [completingActionKey, setCompletingActionKey] = useState<string | null>(null);
  // レーンごとの「もっと見る」で追加表示した件数。初期上限（設定 or MAINTENANCE_LANE_LIMIT）
  // を超えた分だけをここに積む。タブ切替後もレーン別に覚える。
  const [laneExtraVisible, setLaneExtraVisible] = useState<Record<Lane, number>>({
    decision: 0,
    observation: 0,
    maintenance: 0,
  });
  const [executeExtraVisible, setExecuteExtraVisible] = useState(0);
  // UI/UX見直し（今日タブ）対応。既定は「今日やるべき3つ」だけを見せ、残りは
  // EMが明示的に開いたときだけ表示する（重要度が埋もれない密度に抑える）。
  const [restActionsOpen, setRestActionsOpen] = useState(false);
  const [restExecuteOpen, setRestExecuteOpen] = useState(false);
  const [watchlistOpen, setWatchlistOpen] = useState(false);
  const [issueLinkSuggesting, setIssueLinkSuggesting] = useState(false);
  const [issueLinkError, setIssueLinkError] = useState<string | null>(null);
  const [issueLinkPreview, setIssueLinkPreview] = useState<{
    suggestions: IssueStrategyLinkSuggestion[];
    source: "cloud" | "heuristic";
    fallbackReason?: string;
  } | null>(null);
  const [issueLinkApplyingId, setIssueLinkApplyingId] = useState<string | null>(null);

  async function handleSuggestIssueStrategyLinks() {
    setIssueLinkSuggesting(true);
    setIssueLinkError(null);
    try {
      const res = await fetch("/api/issues/link/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "戦略リンク提案に失敗しました");
      setIssueLinkPreview({
        suggestions: Array.isArray(data?.suggestions) ? data.suggestions : [],
        source: data?.source === "cloud" ? "cloud" : "heuristic",
        fallbackReason: typeof data?.fallbackReason === "string" ? data.fallbackReason : undefined,
      });
    } catch (err) {
      setIssueLinkError((err as Error).message);
    } finally {
      setIssueLinkSuggesting(false);
    }
  }

  async function handleAdoptIssueStrategyLink(s: IssueStrategyLinkSuggestion) {
    setIssueLinkApplyingId(s.issueId);
    setIssueLinkError(null);
    try {
      const res = await fetch(`/api/issues/${s.issueId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          themeId: s.themeId,
          keyResultId: s.keyResultId,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "リンクの採用に失敗しました");
      }
      await refreshIssues();
      setIssueLinkPreview((prev) =>
        prev ? { ...prev, suggestions: prev.suggestions.filter((x) => x.issueId !== s.issueId) } : null,
      );
    } catch (err) {
      setIssueLinkError((err as Error).message);
    } finally {
      setIssueLinkApplyingId(null);
    }
  }

  async function handleCompleteExecutionMove(issueId: string, itemId: string) {
    const key = `${issueId}:${itemId}`;
    setCompletingActionKey(key);
    try {
      const res = await fetch(`/api/issues/${issueId}/action-items/${itemId}`, { method: "PATCH" });
      if (res.ok) await refreshIssues();
    } finally {
      setCompletingActionKey(null);
    }
  }

  // docs/em_ui_ux_issue.md 2.2/4節「AI主導トリアージ・上限N件への圧縮」対応。レーンごとに
  // 初期上限を分ける。超過分は非表示にせず、「もっと見る」で +LANE_EXPAND_STEP 件ずつ
  // 同じリストに追加表示する（情報を失わない）。
  const LANE_LIMITS: Record<Lane, number> = {
    decision: decisionQueueLimit,
    observation: observationQueueLimit,
    maintenance: MAINTENANCE_LANE_LIMIT,
  };
  const rankedActions = rankActions(nextActions);
  const top3Actions = rankedActions.slice(0, TOP_ACTIONS_LIMIT);
  const overflowActions = rankedActions.slice(TOP_ACTIONS_LIMIT);
  const restLaneCounts: Record<Lane, number> = { decision: 0, observation: 0, maintenance: 0 };
  for (const a of overflowActions) restLaneCounts[a.lane]++;
  const laneActionsForFilter = overflowActions.filter((a) => a.lane === laneFilter);
  const laneLimit = LANE_LIMITS[laneFilter] + laneExtraVisible[laneFilter];
  const visibleActions = laneActionsForFilter.slice(0, laneLimit);
  const hiddenActionCount = Math.max(0, laneActionsForFilter.length - laneLimit);
  const top3ExecutionMoves = executionMoves.slice(0, TOP_ACTIONS_LIMIT);
  const overflowExecutionMoves = executionMoves.slice(TOP_ACTIONS_LIMIT);
  const executeLimit = INTERVENTION_NEXT_ACTION_LIMIT + executeExtraVisible;
  const visibleExecutionMoves = overflowExecutionMoves.slice(0, executeLimit);
  const hiddenExecutionCount = Math.max(0, overflowExecutionMoves.length - executeLimit);
  // 未ロード中は「課題はありません」と断定しない（空fallbackを実データと誤認させない）。
  const headline = !nextActionsLoaded
    ? "読み込み中…"
    : handMode === "execute"
      ? "進める次の一手"
      : top3Actions.length > 0
        ? "🎯 今日やるべき3つ"
        : "✅ 今日、判断待ちの組織課題はありません。";
  const restCount = overflowActions.length;

  return (
    <div id="today-actions" className={`${styles.panel} ${styles.heroPanel}`}>
      <h2 className={styles.heroHeadline}>{headline}</h2>
      {unlinkedParentCount > 0 && (
        <p className={styles.subtitle} style={{ margin: "0 0 8px", color: "var(--warning, #b45309)" }}>
          ⚠ 戦略未接続の親 Issue が {unlinkedParentCount} 件あります
          <button
            className={styles.detailToggle}
            style={{ marginLeft: 6 }}
            disabled={issueLinkSuggesting}
            onClick={handleSuggestIssueStrategyLinks}
            title="戦略未接続の親 Issue へ、テーマ / KR の紐付けをAIが提案します"
          >
            {issueLinkSuggesting ? "提案中…" : "AIで見直す"}
          </button>
          <button className={styles.detailToggle} style={{ marginLeft: 6 }} onClick={() => onNavigate("/issues")}>
            一覧へ
          </button>
        </p>
      )}
      {issueLinkError && (
        <p className={styles.errorText} role="alert" style={{ marginBottom: 8 }}>
          {issueLinkError}
        </p>
      )}
      {issueLinkPreview && (
        <IssueStrategyLinkSuggestPanel
          suggestions={issueLinkPreview.suggestions}
          source={issueLinkPreview.source}
          fallbackReason={issueLinkPreview.fallbackReason}
          applyingId={issueLinkApplyingId}
          onAdopt={handleAdoptIssueStrategyLink}
          onDismiss={() => setIssueLinkPreview(null)}
          onDismissOne={(issueId) =>
            setIssueLinkPreview((prev) =>
              prev ? { ...prev, suggestions: prev.suggestions.filter((x) => x.issueId !== issueId) } : null,
            )
          }
        />
      )}

      {krTotals.total > 0 && (
        <p className={styles.subtitle} style={{ margin: "0 0 4px" }}>
          📈 今期のKR進捗: {krTotals.done}/{krTotals.total}件
          <button className={styles.detailToggle} style={{ marginLeft: 6 }} onClick={() => onNavigate("/org")}>
            詳細
          </button>
        </p>
      )}
      {autoRunsToday > 0 && (
        <p className={styles.subtitle} style={{ margin: "0 0 8px" }}>
          🤖 本日のAI自動起動: {autoRunsToday}件（出口は起票待ちドラフト）
          <button className={styles.detailToggle} style={{ marginLeft: 6 }} onClick={() => onNavigate("/settings")}>
            頻度を調整
          </button>
        </p>
      )}

      <div className={styles.tabs} style={{ margin: "0 0 12px" }}>
        <button
          type="button"
          className={`${styles.tabBtn} ${handMode === "decide" ? styles.tabBtnActive : ""}`}
          onClick={() => onHandModeChange("decide")}
          title="Yield・起票待ち・異常など、人の判断が要るもの"
        >
          判断{nextActionsLoaded ? `（${nextActions.length}）` : ""}
        </button>
        <button
          type="button"
          className={`${styles.tabBtn} ${handMode === "execute" ? styles.tabBtnActive : ""}`}
          onClick={() => onHandModeChange("execute")}
          title="介入の次の一手をフォーカス順で進める"
        >
          実行{issuesLoaded ? `（${executionMoves.length}）` : ""}
        </button>
      </div>

      {handMode === "decide" ? (
        <>
          {!nextActionsLoaded ? (
            <p className={styles.subtitle}>読み込み中…</p>
          ) : top3Actions.length === 0 ? (
            <p className={styles.subtitle}>✅ 今すぐ決めるべきことはありません。</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 12 }}>
              {top3Actions.map((a, i) => (
                <div
                  key={a.id}
                  className={`${styles.runItem} ${a.severity === "urgent" ? styles.nextActionUrgent : styles.nextActionWarn}`}
                  style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", cursor: "pointer" }}
                  onClick={a.onSelect}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      a.onSelect();
                    }
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <RankBadge n={i + 1} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
                      <span className={styles.badge}>{a.kindLabel}</span>
                      {lastSeenAt !== null && a.since > lastSeenAt && <span className={styles.newBadge}>新着</span>}
                      <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>{LANE_META[a.lane].label}</span>
                    </div>
                    <div className={styles.runItemTask} style={{ whiteSpace: "normal", fontSize: "0.9375rem" }}>
                      {a.icon} {a.text}
                    </div>
                  </div>
                  <button
                    type="button"
                    className={styles.primaryBtn}
                    style={{ width: "auto", flexShrink: 0 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      a.onSelect();
                    }}
                  >
                    {a.ctaLabel ?? "開く"}
                  </button>
                </div>
              ))}
            </div>
          )}

          {restCount > 0 && (
            <div style={{ borderTop: "1px solid var(--border)", paddingTop: 10 }}>
              <button
                type="button"
                className={`${styles.detailToggle} ${styles.detailToggleButton}`}
                onClick={() => setRestActionsOpen(!restActionsOpen)}
              >
                {restActionsOpen
                  ? "閉じる"
                  : `ほかに ${restCount} 件（判断待ち${restLaneCounts.decision}・観測${restLaneCounts.observation}・整備${restLaneCounts.maintenance}）をすべて見る`}
              </button>
              {restActionsOpen && (
                <>
                  <div className={styles.tabs} style={{ margin: "10px 0 10px" }}>
                    {(Object.keys(LANE_META) as Lane[]).map((lane) => (
                      <button
                        key={lane}
                        className={`${styles.tabBtn} ${laneFilter === lane ? styles.tabBtnActive : ""}`}
                        onClick={() => setLaneFilter(lane)}
                        title={LANE_META[lane].hint}
                      >
                        {LANE_META[lane].label}（{restLaneCounts[lane]}）
                      </button>
                    ))}
                  </div>
                  {visibleActions.length === 0 ? (
                    <p className={styles.subtitle}>このレーンの残りはありません。</p>
                  ) : (
                    <>
                      <div className={styles.runList} style={{ maxHeight: "none" }}>
                        {visibleActions.map((a) => (
                          <button
                            key={a.id}
                            className={`${styles.runItem} ${a.severity === "urgent" ? styles.nextActionUrgent : styles.nextActionWarn}`}
                            onClick={a.onSelect}
                          >
                            <span className={styles.badge}>{a.kindLabel}</span>
                            {lastSeenAt !== null && a.since > lastSeenAt && <span className={styles.newBadge}>新着</span>}
                            <div className={styles.runItemTask}>{a.text}</div>
                          </button>
                        ))}
                      </div>
                      {hiddenActionCount > 0 && (
                        <button
                          className={`${styles.detailToggle} ${styles.detailToggleButton}`}
                          style={{ marginTop: 8 }}
                          onClick={() =>
                            setLaneExtraVisible((prev) => ({
                              ...prev,
                              [laneFilter]: prev[laneFilter] + LANE_EXPAND_STEP,
                            }))
                          }
                        >
                          もっと見る（残り{hiddenActionCount}件）
                        </button>
                      )}
                    </>
                  )}
                </>
              )}
            </div>
          )}
        </>
      ) : !issuesLoaded ? (
        <p className={styles.subtitle}>読み込み中…</p>
      ) : executionMoves.length === 0 ? (
        <p className={styles.subtitle}>✅ 進める次の一手はありません。</p>
      ) : (
        <>
          <p className={styles.subtitle} style={{ margin: "0 0 8px" }}>
            介入の優先度順（フォーカス → 通常）。完了すると次の未完了が繰り上がります。
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 12 }}>
            {top3ExecutionMoves.map((move, i) => {
              const key = `${move.issueId}:${move.itemId}`;
              const priorityMeta = ISSUE_PRIORITY_META[move.priority];
              return (
                <div
                  key={key}
                  className={`${styles.runItem} ${move.blocked ? styles.nextActionUrgent : styles.nextActionWarn}`}
                  style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "12px 14px", textAlign: "left" }}
                >
                  <RankBadge n={i + 1} />
                  <input
                    type="checkbox"
                    checked={false}
                    disabled={completingActionKey === key}
                    aria-label={`「${move.itemText}」を完了`}
                    onChange={() => void handleCompleteExecutionMove(move.issueId, move.itemId)}
                    style={{ marginTop: 5, flexShrink: 0 }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 4 }}>
                      <span className={styles.badge}>
                        {priorityMeta.icon} {priorityMeta.label}
                      </span>
                      {move.blocked && <span className={styles.badge}>Waiting</span>}
                      <button type="button" className={styles.tableRowLink} onClick={() => onNavigate(`/issues/${move.issueId}`)}>
                        {move.issueTitle}
                      </button>
                    </div>
                    <div className={styles.runItemTask} style={{ whiteSpace: "normal", fontSize: "0.9375rem" }}>
                      {move.itemText}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {overflowExecutionMoves.length > 0 && (
            <div style={{ borderTop: "1px solid var(--border)", paddingTop: 10 }}>
              <button
                type="button"
                className={`${styles.detailToggle} ${styles.detailToggleButton}`}
                onClick={() => setRestExecuteOpen(!restExecuteOpen)}
              >
                {restExecuteOpen ? "閉じる" : `ほかに ${overflowExecutionMoves.length} 件をすべて見る`}
              </button>
              {restExecuteOpen && (
                <>
                  <div className={styles.runList} style={{ maxHeight: "none", marginTop: 10 }}>
                    {visibleExecutionMoves.map((move) => {
                      const key = `${move.issueId}:${move.itemId}`;
                      const priorityMeta = ISSUE_PRIORITY_META[move.priority];
                      return (
                        <div
                          key={key}
                          className={`${styles.runItem} ${move.blocked ? styles.nextActionUrgent : styles.nextActionWarn}`}
                          style={{ display: "flex", alignItems: "flex-start", gap: 10, textAlign: "left" }}
                        >
                          <input
                            type="checkbox"
                            checked={false}
                            disabled={completingActionKey === key}
                            aria-label={`「${move.itemText}」を完了`}
                            onChange={() => void handleCompleteExecutionMove(move.issueId, move.itemId)}
                            style={{ marginTop: 4, flexShrink: 0 }}
                          />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 4 }}>
                              <span className={styles.badge}>
                                {priorityMeta.icon} {priorityMeta.label}
                              </span>
                              {move.blocked && <span className={styles.badge}>Waiting</span>}
                              <button
                                type="button"
                                className={styles.tableRowLink}
                                onClick={() => onNavigate(`/issues/${move.issueId}`)}
                              >
                                {move.issueTitle}
                              </button>
                            </div>
                            <div className={styles.runItemTask}>{move.itemText}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {hiddenExecutionCount > 0 && (
                    <button
                      className={`${styles.detailToggle} ${styles.detailToggleButton}`}
                      style={{ marginTop: 8 }}
                      onClick={() => setExecuteExtraVisible((n) => n + LANE_EXPAND_STEP)}
                    >
                      もっと見る（残り{hiddenExecutionCount}件）
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </>
      )}

      {watchingItems.length > 0 && (
        <div style={{ marginTop: 14, borderTop: "1px solid var(--border)", paddingTop: 10 }}>
          <button className={`${styles.detailToggle} ${styles.detailToggleButton}`} onClick={() => setWatchlistOpen(!watchlistOpen)}>
            👀 様子見中（{watchingItems.length}件）{watchlistOpen ? "を隠す" : "を見る"}
          </button>
          {watchlistOpen && (
            <div className={styles.tableWrap} style={{ marginTop: 8 }}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>経過</th>
                    <th>内容</th>
                  </tr>
                </thead>
                <tbody>
                  {watchingItems.map((run) => {
                    const days = Math.round((now - (run.triageAt ?? run.updatedAt)) / (24 * 60 * 60 * 1000));
                    // 相談履歴(U12)と同じく、定型の指示文ではなく Journal 本文／結論を主役にする。
                    const title = truncateExcerpt(consultListTitle(run), 100);
                    const secondary = consultListSecondary(run);
                    const meta = consultListMetaParts(run, { omitTime: true, omitTriage: true }).join(" · ");
                    return (
                      <tr key={run.id}>
                        <td className={styles.tableMuted}>{days === 0 ? "今日から" : `${days}日前から`}</td>
                        <td>
                          <button className={styles.tableRowLink} onClick={() => onNavigate(`/chat?runId=${run.id}`)}>
                            {title}
                          </button>
                          {secondary && (
                            <div className={styles.tableMuted} style={{ marginTop: 2, fontSize: "0.75rem" }}>
                              {truncateExcerpt(secondary, 120)}
                            </div>
                          )}
                          {meta && (
                            <div className={styles.tableMuted} style={{ marginTop: 2, fontSize: "0.75rem" }}>
                              {meta}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
