import { useState } from "react";
import styles from "../../styles/page.module.css";
import { consultListMetaParts } from "../consultListMeta";
import type { AgentRun } from "../RunDetail";
import { SuggestionStrategyLinkSuggestPanel } from "../HierarchyLinkSuggestPanel";
import { consultListSecondary, consultListTitle, truncateExcerpt } from "@emther/core/origin-trace";
import type { SuggestionStrategyLinkSuggestion } from "@emther/core/types";
import { LANE_META, rankActions, urgencyMeter, type Lane, type NextAction } from "../../lib/dashboard-next-actions";
import { formatElapsedLabel } from "../../lib/today-state";

const MAINTENANCE_LANE_LIMIT = 3;
const LANE_EXPAND_STEP = 3;
const TOP_ACTIONS_LIMIT = 3;

type Props = {
  now: number;
  nextActions: NextAction[];
  nextActionsLoaded: boolean;
  decisionQueueLimit: number;
  observationQueueLimit: number;
  watchingItems: AgentRun[];
  lastSeenAt: number | null;
  unlinkedParentCount: number;
  onNavigate: (path: string) => void;
  suggestionLinkSuggesting: boolean;
  suggestionLinkError: string | null;
  suggestionLinkPreview: {
    suggestions: SuggestionStrategyLinkSuggestion[];
    source: "cloud" | "heuristic";
    fallbackReason?: string;
  } | null;
  suggestionLinkApplyingId: string | null;
  onSuggestSuggestionStrategyLinks: () => void;
  onAdoptSuggestionStrategyLink: (s: SuggestionStrategyLinkSuggestion) => void;
  onDismissSuggestionLinkPreview: () => void;
  onDismissSuggestionLinkOne: (suggestionId: string) => void;
};

export function TodayActionsPanel({
  now,
  nextActions,
  nextActionsLoaded,
  decisionQueueLimit,
  observationQueueLimit,
  watchingItems,
  lastSeenAt,
  unlinkedParentCount,
  onNavigate,
  suggestionLinkSuggesting,
  suggestionLinkError,
  suggestionLinkPreview,
  suggestionLinkApplyingId,
  onSuggestSuggestionStrategyLinks,
  onAdoptSuggestionStrategyLink,
  onDismissSuggestionLinkPreview,
  onDismissSuggestionLinkOne,
}: Props) {
  const [laneFilter, setLaneFilter] = useState<Lane>("decision");
  const [laneExtraVisible, setLaneExtraVisible] = useState<Record<Lane, number>>({
    decision: 0,
    observation: 0,
    maintenance: 0,
  });
  const [restActionsOpen, setRestActionsOpen] = useState(false);
  const [watchlistOpen, setWatchlistOpen] = useState(false);

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
  const restCount = overflowActions.length;

  return (
    <div id="today-actions" className={`${styles.panel} ${styles.heroPanel}`}>
      <div className={styles.todayActionsHeroHead}>
        <div>
          <h2 className={styles.heroHeadline}>
            {!nextActionsLoaded
              ? "読み込み中…"
              : top3Actions.length > 0
                ? "今日やるべき3つ"
                : "今日、判断待ちの組織課題はありません"}
          </h2>
          {top3Actions.length > 0 && (
            <p className={styles.todayActionsHeroSub}>いま決めると、組織が前に進むものだけを並べています</p>
          )}
        </div>
        {restCount > 0 && (
          <div className={styles.todayActionsQueueBadge} aria-label={`残り ${restCount} 件`}>
            <span className={styles.todayActionsQueueCount}>+{restCount}</span>
            <span className={styles.todayActionsQueueLabel}>残り</span>
          </div>
        )}
      </div>

      {unlinkedParentCount > 0 && (
        <p className={styles.subtitle} style={{ margin: "0 0 8px", color: "var(--warning, #b45309)" }}>
          ⚠ 戦略未接続の親 提案 が {unlinkedParentCount} 件あります
          <button
            className={`${styles.detailToggle} ${styles.axisTooltip}`}
            style={{ marginLeft: 6 }}
            disabled={suggestionLinkSuggesting}
            onClick={onSuggestSuggestionStrategyLinks}
            data-tooltip="戦略未接続の親 提案 へ、テーマ / KR の紐付けをAIが提案します"
          >
            {suggestionLinkSuggesting ? "提案中…" : "AIで見直す"}
          </button>
          <button className={styles.detailToggle} style={{ marginLeft: 6 }} onClick={() => onNavigate("/suggestions")}>
            一覧へ
          </button>
        </p>
      )}
      {suggestionLinkError && (
        <p className={styles.errorText} role="alert" style={{ marginBottom: 8 }}>
          {suggestionLinkError}
        </p>
      )}
      {suggestionLinkPreview && (
        <SuggestionStrategyLinkSuggestPanel
          suggestions={suggestionLinkPreview.suggestions}
          source={suggestionLinkPreview.source}
          fallbackReason={suggestionLinkPreview.fallbackReason}
          applyingId={suggestionLinkApplyingId}
          onAdopt={onAdoptSuggestionStrategyLink}
          onDismiss={onDismissSuggestionLinkPreview}
          onDismissOne={onDismissSuggestionLinkOne}
        />
      )}

      {!nextActionsLoaded ? (
        <p className={styles.subtitle}>読み込み中…</p>
      ) : top3Actions.length === 0 ? (
        <p className={styles.subtitle}>今すぐ決めるべきことはありません。</p>
      ) : (
        <div className={styles.todayActionCardList}>
          {top3Actions.map((a, i) => {
            const elapsed = formatElapsedLabel(a.since, now);
            const urgency = urgencyMeter(a);
            return (
              <div
                key={a.id}
                className={`${styles.todayActionCard} ${a.severity === "urgent" ? styles.todayActionCardUrgent : styles.todayActionCardWarn}`}
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
                <div className={styles.todayActionRank}>
                  <span className={styles.todayActionRankNum}>{i + 1}</span>
                  {elapsed && <span className={styles.todayActionElapsed}>{elapsed}</span>}
                </div>
                <div className={styles.todayActionBody}>
                  <div className={styles.todayActionTitleRow}>
                    <span className={styles.todayActionTitle}>{a.text}</span>
                    {((lastSeenAt !== null && a.since > lastSeenAt) ||
                      (lastSeenAt === null && now - a.since < 24 * 60 * 60 * 1000)) && (
                      <span className={styles.newBadge}>新着</span>
                    )}
                  </div>
                  <p className={styles.todayActionMeta}>
                    {LANE_META[a.lane].label} · {a.kindLabel}
                    {a.ctaLabel ? ` · ${a.ctaLabel.replace(/する$/, "")}` : ""}
                  </p>
                  <div
                    className={styles.todayActionUrgency}
                    title="この順番で上がっている目安（優先度・緊急度から算出）"
                  >
                    <span className={styles.todayActionUrgencyLabel}>緊急度</span>
                    <div className={styles.todayActionUrgencyTrack}>
                      <div
                        className={`${styles.todayActionUrgencyFill} ${styles[`todayActionUrgencyFill-${urgency.tone}`]}`}
                        style={{ width: `${Math.round(urgency.ratio * 100)}%` }}
                      />
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  className={styles.todayActionCta}
                  onClick={(e) => {
                    e.stopPropagation();
                    a.onSelect();
                  }}
                >
                  {a.ctaLabel ?? "開く"}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {(restCount > 0 || watchingItems.length > 0) && (
        <div className={styles.todayActionsRest}>
          <div className={styles.todayActionsRestToggles}>
            {restCount > 0 && (
              <button
                type="button"
                className={`${styles.detailToggle} ${styles.detailToggleButton}`}
                onClick={() => setRestActionsOpen(!restActionsOpen)}
              >
                {restActionsOpen
                  ? "閉じる"
                  : `ほか ${restCount} 件をレーン別に見る（判断${restLaneCounts.decision} · 観測${restLaneCounts.observation} · 整備${restLaneCounts.maintenance}）`}
              </button>
            )}
            {watchingItems.length > 0 && (
              <button
                type="button"
                className={`${styles.detailToggle} ${styles.detailToggleButton}`}
                onClick={() => setWatchlistOpen(!watchlistOpen)}
              >
                {watchlistOpen ? "様子見を隠す" : `様子見 ${watchingItems.length}件`}
              </button>
            )}
          </div>

          {restActionsOpen && restCount > 0 && (
            <div className={styles.todayActionsRestBody}>
              <div className={styles.tabs}>
                {(Object.keys(LANE_META) as Lane[]).map((lane) => (
                  <button
                    key={lane}
                    className={`${styles.tabBtn} ${laneFilter === lane ? styles.tabBtnActive : ""} ${styles.axisTooltip}`}
                    onClick={() => setLaneFilter(lane)}
                    data-tooltip={LANE_META[lane].hint}
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
                        {((lastSeenAt !== null && a.since > lastSeenAt) ||
                          (lastSeenAt === null && now - a.since < 24 * 60 * 60 * 1000)) && (
                          <span className={styles.newBadge}>新着</span>
                        )}
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
            </div>
          )}

          {watchlistOpen && watchingItems.length > 0 && (
            <div className={styles.todayActionsWatchBlock}>
              <h3 className={styles.todayActionsWatchHeading}>
                様子見中（{watchingItems.length}件）
              </h3>
              <p className={styles.todayActionsWatchHint}>
                「様子見」にした相談です。一定期間たつと判断待ちへ再浮上します。
              </p>
              <div className={styles.tableWrap}>
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
            </div>
          )}
        </div>
      )}
    </div>
  );
}
