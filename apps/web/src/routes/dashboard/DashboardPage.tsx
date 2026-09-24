import { useEffect, useState } from "react";
import { useNavigate } from "@/router";
import styles from "../../styles/page.module.css";
import { NameCandidateConfirmDialog } from "../../components/NameCandidateConfirmDialog";
import { SetupGapsBanner } from "../../components/dashboard/SetupGapsBanner";
import { DailySituationPanel } from "../../components/dashboard/DailySituationPanel";
import { EveningReviewCard } from "../../components/dashboard/EveningReviewCard";
import { NowStatePanel } from "../../components/dashboard/NowStatePanel";
import { ReportNudgeBanner } from "../../components/dashboard/ReportNudgeBanner";
import { ThemesPanel } from "../../components/dashboard/ThemesPanel";
import { TodayActionsPanel } from "../../components/dashboard/TodayActionsPanel";
import { buildNextActions, selectWatchingItems, attachNextActionHandlers } from "../../lib/dashboard-next-actions";
import { buildDailySituation, attachDailySituationHandlers } from "../../lib/daily-situation";
import { buildTodayStateMeters, attachTodayStateHandlers } from "../../lib/today-state";
import { selectReportNudges } from "../../lib/report-nudge";
import {
  useEmCheckins,
  useGoals,
  useGoToRunSuggestion,
  useJournal,
  useOrgStrategy,
  usePeople,
  useRuns,
  useSettingsRules,
  useSuggestions,
  useTeams,
  useThemes,
  useVitals,
} from "../../lib/queries";
import { useNameCandidateConfirm } from "../../lib/useNameCandidateConfirm";
import { api, rpcInit } from "../../lib/api-client";
import {
  isSuggestionOpen,
  isSuggestionStrategyUnlinked,
  isRunStale,
  type SuggestionStrategyLinkSuggestion,
  type PendingUnmaskedSend,
} from "@emther/core/types";
import type { SuggestionsLinkSuggestResponse } from "@emther/api-contract";

// react-routerのuseSearchParamsを使わないため、元実装の<Suspense>ラッパーは不要（削除した）。
export function DashboardPage() {
  const navigate = useNavigate();
  // レンダー内で複数回Date.now()を呼ぶと呼ぶたびに結果がずれるため、このレンダーでの
  // 「現在時刻」として1回だけ取得し使い回す（経過時間の表示用途であり、他のポーリングで
  // どのみち定期的に再レンダーされるため、1回の取得で十分）。
  // eslint-disable-next-line react-hooks/purity -- 「NEW」バッジ・経過時間表示にのみ使う
  const now = Date.now();

  // 前回このダッシュボードを
  // 開いた時刻をブラウザのlocalStorageに記録し（サーバー側の既読管理は増やさない軽量な
  // 実装）、判断待ちカードのうち根拠の時刻がそれより新しいものにだけ「NEW」を出す
  // 初回訪問（保存値なし）はnullにし、「全部NEW」という誤った印象を与えない
  const [lastSeenAt] = useState<number | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const stored = window.localStorage.getItem("em-dashboard-last-seen");
      return stored ? Number(stored) : null;
    } catch {
      return null;
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem("em-dashboard-last-seen", String(Date.now()));
    } catch {
      // localStorageが使えない環境でも「NEW」表示を諦めるだけで、閲覧自体は妨げない
    }
  }, []);

  const { runs, pendingAgentStarts, pendingUnmaskedSends, runsLoaded, refreshRuns } = useRuns();
  const { suggestions, suggestionsLoaded, refreshSuggestions } = useSuggestions();
  const goToRunSuggestion = useGoToRunSuggestion(suggestions);

  // TodayActionsPanelはダッシュボード／書き連ねタブの切り替えでアンマウントされるため
  // 生成中フラグ・結果をこのコンポーネント（タブ切り替えで不変）側に持たせる
  const [suggestionLinkSuggesting, setSuggestionLinkSuggesting] = useState(false);
  const [suggestionLinkError, setSuggestionLinkError] = useState<string | null>(null);
  const [suggestionLinkPreview, setSuggestionLinkPreview] = useState<{
    suggestions: SuggestionStrategyLinkSuggestion[];
    source: "cloud" | "heuristic";
    fallbackReason?: string;
  } | null>(null);
  const [suggestionLinkApplyingId, setSuggestionLinkApplyingId] = useState<string | null>(null);

  async function handleSuggestSuggestionStrategyLinks() {
    setSuggestionLinkSuggesting(true);
    setSuggestionLinkError(null);
    try {
      const res = await api.api.suggestions.link.suggest.$post({ json: {} });
      const data = (await res.json().catch(() => null)) as (SuggestionsLinkSuggestResponse & { error?: string }) | null;
      if (!res.ok) throw new Error(data?.error ?? "戦略リンク提案に失敗しました");
      setSuggestionLinkPreview({
        suggestions: Array.isArray(data?.suggestions) ? data.suggestions : [],
        source: data?.source === "cloud" ? "cloud" : "heuristic",
        fallbackReason: typeof data?.fallbackReason === "string" ? data.fallbackReason : undefined,
      });
    } catch (err) {
      setSuggestionLinkError((err as Error).message);
    } finally {
      setSuggestionLinkSuggesting(false);
    }
  }

  async function handleAdoptSuggestionStrategyLink(s: SuggestionStrategyLinkSuggestion) {
    setSuggestionLinkApplyingId(s.suggestionId);
    setSuggestionLinkError(null);
    try {
      const res = await api.api.suggestions[":id"].$patch(rpcInit({
        param: { id: s.suggestionId },
        json: { themeId: s.themeId },
      }));
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? "リンクの採用に失敗しました");
      }
      await refreshSuggestions();
      setSuggestionLinkPreview((prev) =>
        prev ? { ...prev, suggestions: prev.suggestions.filter((x) => x.suggestionId !== s.suggestionId) } : null,
      );
    } catch (err) {
      setSuggestionLinkError((err as Error).message);
    } finally {
      setSuggestionLinkApplyingId(null);
    }
  }
  const { vitals, vitalsLoaded } = useVitals();
  const { journalEntries, journalLoaded } = useJournal();
  const { checkins, checkinsLoaded } = useEmCheckins();
  const { rules } = useSettingsRules();
  const { strategy, strategyLoaded } = useOrgStrategy();
  const { teams, teamsLoaded } = useTeams();
  const { goals, goalsLoaded } = useGoals();
  // People を朝キューにも薄く編入する
  const { people, peopleLoaded } = usePeople();
  const { themes, themesLoaded, refreshThemes } = useThemes();
  // 初回フェッチ完了前の空fallbackを「未設定／0件／対応不要」と誤表示しないためのゲート。
  // SettingsのrulesLoadedと同じ考え方（usePollingのloaded）。
  const setupLoaded = strategyLoaded && teamsLoaded && goalsLoaded;
  const nextActionsLoaded = runsLoaded && suggestionsLoaded && vitalsLoaded && journalLoaded && peopleLoaded;

  // statusが"active"のまま
  // ログ更新が閾値以上無いrunをクライアント側で判定し、Fleet/Next Actions/Inboxで警告表示する
  const staleRunIds = new Set(
    runs.filter((r) => isRunStale(r.status, r.updatedAt, rules.agentStaleAfterSeconds)).map((r) => r.id),
  );

  const { nameCandidateDialog } = useNameCandidateConfirm();
  const [confirmingUnmasked, setConfirmingUnmasked] = useState<PendingUnmaskedSend | null>(null);
  const [confirmingUnmaskedBusy, setConfirmingUnmaskedBusy] = useState(false);

  // クイック入力のプリフィル時は /journal?prefill=... へ遷移
  function prefillJournal(text: string) {
    navigate(`/journal?prefill=${encodeURIComponent(text)}`);
  }

  const watchingItems = selectWatchingItems(runs, suggestions);
  const coreNextActions = buildNextActions({
    now,
    runs,
    suggestions,
    journalEntries,
    people,
    vitals,
    pendingAgentStarts,
    pendingUnmaskedSends,
    staleRunIds,
    watchingItems,
  });
  const actionHandlers = {
    push: (path: string) => navigate(path),
    goToRunSuggestion: (runId: string) => {
      const run = runs.find((r) => r.id === runId);
      if (run) void goToRunSuggestion(run);
    },
    prefillJournal,
    onConfirmUnmasked: (pendingId: string) => {
      const pending = pendingUnmaskedSends.find((p) => p.id === pendingId);
      if (pending) setConfirmingUnmasked(pending);
    },
  };
  const nextActions = attachNextActionHandlers(coreNextActions, actionHandlers);

  // 今日の状況をまとめる（提案駆動ではなく Journal/Vitals/People 駆動）
  // 気になる兆候は組織レベルのパターン（停滞提案含む）なので suggestions も渡す
  const dailySituation = attachDailySituationHandlers(
    buildDailySituation({
      now,
      journalEntries,
      vitals,
      people,
      nextActions: coreNextActions,
      suggestions,
      staleInterventionDays: rules.staleInterventionDays,
    }),
    actionHandlers,
  );
  const dailySituationLoaded = nextActionsLoaded;

  // 「いまの状態」メーターと健全度内訳
  const todayMeters = attachTodayStateHandlers(
    buildTodayStateMeters({
      now,
      journalEntries,
      vitals,
      people,
      nextActions: coreNextActions,
      decisionQueueLimit: rules.decisionQueueLimit,
      observationQueueLimit: rules.observationQueueLimit,
    }),
    actionHandlers,
  );

  // 「1日の上限感」をUIで示す（ハード制限はせず
  // 今日どれだけAIが自動的にRunを起動したかの感覚をEMに持たせる）
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const autoRunsToday = runs.filter((r) => r.origin !== "manual" && r.createdAt >= todayStart.getTime()).length;

  // 入力フォーム自体はここには置かず、未記録のときだけ気づかせて /evening-review → /checkin へ誘導する
  const hasCheckinToday = checkins.some((c) => c.createdAt >= todayStart.getTime());

  // 週次・月次レポートの弱い案内
  const reportNudges = selectReportNudges({ now, runs });

  // 空の前提のままエージェントが
  // 走らないよう、MVV/Team/Goalが揃うまでセットアップ導線を出す。新規ウィザード画面は
  // 増やさず、既存の/orgへの案内に留める（EMが明示的に消せるものではなく、実際に揃うと
  // 自然に消える）。未ロード中は空fallbackを「未設定」と誤認しないよう計算しない
  const setupGaps: string[] = [];
  if (setupLoaded) {
    if (!strategy.mission && !strategy.vision && !strategy.values) setupGaps.push("MVV未設定");
    if (teams.length === 0) setupGaps.push(`Team ${teams.length}件`);
    if (goals.length === 0) setupGaps.push(`Goal ${goals.length}件`);
  }

  const unlinkedParentCount = suggestions.filter((s) => isSuggestionOpen(s) && isSuggestionStrategyUnlinked(s)).length;

  return (
    <div className={styles.screen}>
      <SetupGapsBanner
        setupGaps={setupGaps}
        teamsCount={teams.length}
        hasMvv={!!(strategy.mission || strategy.vision || strategy.values)}
        goalsCount={goals.length}
        onNavigate={(path) => navigate(path)}
      />

      {/* 主問を奪わない薄いレポート案内 */}
      <ReportNudgeBanner
        primary={reportNudges.primary}
        secondary={reportNudges.secondary}
        onOpenReport={(runId) => navigate(`/chat?runId=${encodeURIComponent(runId)}`)}
      />

      {/* 未記録時のみ薄い帯 */}
      <EveningReviewCard
        checkinsLoaded={checkinsLoaded}
        hasCheckinToday={hasCheckinToday}
        onStart={() => navigate("/evening-review")}
      />

      {/* 状態の量化を先頭へ */}
      <NowStatePanel
        meters={todayMeters}
        loaded={dailySituationLoaded}
        runs={runs}
        runsLoaded={runsLoaded}
        autoRunsToday={autoRunsToday}
        coverageWindowDays={rules.coverageWindowDays}
        onNavigate={(path) => navigate(path)}
        now={now}
      />

      <TodayActionsPanel
        now={now}
        nextActions={nextActions}
        nextActionsLoaded={nextActionsLoaded}
        decisionQueueLimit={rules.decisionQueueLimit}
        observationQueueLimit={rules.observationQueueLimit}
        watchingItems={watchingItems}
        lastSeenAt={lastSeenAt}
        unlinkedParentCount={unlinkedParentCount}
        onNavigate={(path) => navigate(path)}
        suggestionLinkSuggesting={suggestionLinkSuggesting}
        suggestionLinkError={suggestionLinkError}
        suggestionLinkPreview={suggestionLinkPreview}
        suggestionLinkApplyingId={suggestionLinkApplyingId}
        onSuggestSuggestionStrategyLinks={handleSuggestSuggestionStrategyLinks}
        onAdoptSuggestionStrategyLink={handleAdoptSuggestionStrategyLink}
        onDismissSuggestionLinkPreview={() => setSuggestionLinkPreview(null)}
        onDismissSuggestionLinkOne={(suggestionId) =>
          setSuggestionLinkPreview((prev) =>
            prev ? { ...prev, suggestions: prev.suggestions.filter((x) => x.suggestionId !== suggestionId) } : null,
          )
        }
      />

      <ThemesPanel
        themes={themes}
        themesLoaded={themesLoaded}
        goals={goals}
        refreshThemes={refreshThemes}
        refreshRuns={refreshRuns}
        onNavigate={(path) => navigate(path)}
      />

      {/* 材料は下部。状態チップはいまの状態へ */}
      <DailySituationPanel
        situation={dailySituation}
        loaded={dailySituationLoaded}
        weeklyTone={todayMeters.weeklyTone}
        attentionChips={todayMeters.attentionChips}
      />

      {nameCandidateDialog}
      {confirmingUnmasked && (
        <NameCandidateConfirmDialog
          candidates={confirmingUnmasked.candidates}
          actionLabel="送信する"
          busy={confirmingUnmaskedBusy}
          onCancel={async () => {
            setConfirmingUnmaskedBusy(true);
            try {
              await api.api.agents["pending-unmasked"][":id"].$post(rpcInit({
                param: { id: confirmingUnmasked.id },
                json: { action: "dismiss" },
              }));
              await refreshRuns();
            } finally {
              setConfirmingUnmaskedBusy(false);
              setConfirmingUnmasked(null);
            }
          }}
          onAllow={async () => {
            setConfirmingUnmaskedBusy(true);
            try {
              await api.api.agents["pending-unmasked"][":id"].$post(rpcInit({
                param: { id: confirmingUnmasked.id },
                json: { action: "confirm" },
              }));
              await refreshRuns();
            } finally {
              setConfirmingUnmaskedBusy(false);
              setConfirmingUnmasked(null);
            }
          }}
          onRegister={async () => {
            setConfirmingUnmaskedBusy(true);
            try {
              await api.api.agents["pending-unmasked"][":id"].$post(rpcInit({
                param: { id: confirmingUnmasked.id },
                json: { action: "confirm", registerNameCandidates: true },
              }));
              await refreshRuns();
            } finally {
              setConfirmingUnmaskedBusy(false);
              setConfirmingUnmasked(null);
            }
          }}
        />
      )}
    </div>
  );
}
