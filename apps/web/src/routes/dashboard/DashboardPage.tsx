import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import styles from "../../styles/page.module.css";
import { NameCandidateConfirmDialog } from "../../components/NameCandidateConfirmDialog";
import { SetupGapsBanner } from "../../components/dashboard/SetupGapsBanner";
import { DailySituationPanel } from "../../components/dashboard/DailySituationPanel";
import { EveningReviewCard } from "../../components/dashboard/EveningReviewCard";
import { ThemesPanel } from "../../components/dashboard/ThemesPanel";
import { TodayActionsPanel } from "../../components/dashboard/TodayActionsPanel";
import { buildNextActions, selectWatchingItems } from "../../lib/dashboard-next-actions";
import { buildDailySituation } from "../../lib/daily-situation";
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
import {
  isSuggestionOpen,
  isSuggestionStrategyUnlinked,
  isRunStale,
  type SuggestionStrategyLinkSuggestion,
  type PendingUnmaskedSend,
} from "@emther/core/types";

// react-routerのuseSearchParamsを使わないため、元実装の<Suspense>ラッパーは不要（削除した）。
export function DashboardPage() {
  const navigate = useNavigate();
  // レンダー内で複数回Date.now()を呼ぶと呼ぶたびに結果がずれるため、このレンダーでの
  // 「現在時刻」として1回だけ取得し使い回す（経過時間の表示用途であり、他のポーリングで
  // どのみち定期的に再レンダーされるため、1回の取得で十分）。
  // eslint-disable-next-line react-hooks/purity -- 「NEW」バッジ・経過時間表示にのみ使う
  const now = Date.now();

  // 改修依頼「以前から変わったことがより分かりやすいUIに」対応。前回このダッシュボードを
  // 開いた時刻をブラウザのlocalStorageに記録し（サーバー側の既読管理は増やさない軽量な
  // 実装）、判断待ちカードのうち根拠の時刻がそれより新しいものにだけ「NEW」を出す。
  // 初回訪問（保存値なし）はnullにし、「全部NEW」という誤った印象を与えない。
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

  // docs/memo.md「今日タブでAIに戦略を提案させている最中にタブを切り替えると結果が消える」
  // 対応。TodayActionsPanelはダッシュボード／書き連ねタブの切り替えでアンマウントされるため、
  // 生成中フラグ・結果をこのコンポーネント（タブ切り替えで不変）側に持たせる。
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
      const res = await fetch("/api/suggestions/link/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => null);
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
      const res = await fetch(`/api/suggestions/${s.suggestionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          themeId: s.themeId,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
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
  // 改修依頼「今日の振り返りに、今日記録されていない場合のアラートを出す」対応。
  const { checkins, checkinsLoaded } = useEmCheckins();
  const { rules } = useSettingsRules();
  // docs/memo.md「O. 期初の憲法づくりオンボーディング」対応。
  const { strategy, strategyLoaded } = useOrgStrategy();
  const { teams, teamsLoaded } = useTeams();
  const { goals, goalsLoaded } = useGoals();
  // docs/em_human_story_and_ux.md P1-10対応。People(J)を朝キューにも薄く編入する。
  const { people, peopleLoaded } = usePeople();
  const { themes, themesLoaded, refreshThemes } = useThemes();
  // 初回フェッチ完了前の空fallbackを「未設定／0件／対応不要」と誤表示しないためのゲート。
  // SettingsのrulesLoadedと同じ考え方（usePollingのloaded）。
  const setupLoaded = strategyLoaded && teamsLoaded && goalsLoaded;
  const nextActionsLoaded = runsLoaded && suggestionsLoaded && vitalsLoaded && journalLoaded && peopleLoaded;

  // docs/memo.md TODO「動いていると思ったら止まっていた、を防ぐ」対応。statusが"active"のまま
  // ログ更新が閾値以上無いrunをクライアント側で判定し、Fleet/Next Actions/Inboxで警告表示する。
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

  // ユーザー指摘「『判断待ちがN件あります』の確認先がわからない」対応。今日の状況の
  // 「判断する価値がありそうなこと」から、実際にその件数の内訳が並ぶ「今日やるべき3つ」
  // まで確実に辿れるようにする。
  function scrollToTodayActions() {
    requestAnimationFrame(() => {
      document.getElementById("today-actions")?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    });
  }

  const watchingItems = selectWatchingItems(runs, suggestions);
  const nextActions = buildNextActions({
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
    goToRunSuggestion,
    push: (path) => navigate(path),
    prefillJournal,
    onConfirmUnmasked: setConfirmingUnmasked,
  });

  // docs/2nd_pivot_version.md Phase 1対応。pivot_policy.md「目指すUX」の6項目で
  // 今日の状況をまとめる（提案駆動ではなく Journal/Vitals/People 駆動）。
  const dailySituation = buildDailySituation({
    now,
    journalEntries,
    vitals,
    people,
    nextActions,
    push: (path: string) => navigate(path),
    prefillJournal,
  });
  const dailySituationLoaded = nextActionsLoaded;

  // docs/em_human_story_and_ux.md P0-4対応。「1日の上限感」をUIで示す（ハード制限はせず、
  // 今日どれだけAIが自動的にRunを起動したかの感覚をEMに持たせる）。
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const autoRunsToday = runs.filter((r) => r.origin !== "manual" && r.createdAt >= todayStart.getTime()).length;

  // 改修依頼「今日の振り返りは、今日記録されていない場合のアラート表示」対応。
  // 入力フォーム自体はここには置かず、未記録のときだけ気づかせて /evening-review → /checkin へ誘導する。
  const hasCheckinToday = checkins.some((c) => c.createdAt >= todayStart.getTime());

  // docs/memo.md「O. 期初の憲法づくりオンボーディング」対応。空の前提のままエージェントが
  // 走らないよう、MVV/Team/Goalが揃うまでセットアップ導線を出す。新規ウィザード画面は
  // 増やさず、既存の/orgへの案内に留める（EMが明示的に消せるものではなく、実際に揃うと
  // 自然に消える）。未ロード中は空fallbackを「未設定」と誤認しないよう計算しない。
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

      {/* docs/em_ui_ux_issue.md 3節「Evening Mode」対応。ユーザー指摘「午前で1日の仕事を
          終える可能性もあるので、時間で出し分けるのはやめたい」対応。1日の終業は時刻で
          決まらないため、時間帯によるゲーティングはせず常に表示する。随時メモへの導線
          （旧・夜の書き連ね）は、1日の締めくくりフローと役割が重複するため廃止した。 */}
      <EveningReviewCard
        checkinsLoaded={checkinsLoaded}
        hasCheckinToday={hasCheckinToday}
        onStart={() => navigate("/evening-review")}
      />

      {/* ユーザー指摘「今日やるべき3つを上に持ってきたことで、一言診断バナー（判断待ちが
          N件あります）がほぼ意味をなさない」対応。一言診断バナーは廃止し、「今日やるべき
          3つ」をファーストビューの先頭として直接出す。 */}
      <TodayActionsPanel
        now={now}
        nextActions={nextActions}
        nextActionsLoaded={nextActionsLoaded}
        decisionQueueLimit={rules.decisionQueueLimit}
        observationQueueLimit={rules.observationQueueLimit}
        watchingItems={watchingItems}
        lastSeenAt={lastSeenAt}
        unlinkedParentCount={unlinkedParentCount}
        autoRunsToday={autoRunsToday}
        runs={runs}
        runsLoaded={runsLoaded}
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

      {/* ユーザー指摘「チームの状態パネルと今日の状況のチーム表示が被っている」対応。
          独立パネル（旧TeamStatePanel）は廃止し、チーム/メンバーの状態は今日の状況の
          ステータスチップに一本化する（1on1 Coverageもdaily-situation.ts側で統合済み）。 */}
      <DailySituationPanel situation={dailySituation} loaded={dailySituationLoaded} onSeeAllDecisions={scrollToTodayActions} />

      {/* UI/UX見直し（今日タブ）対応。「状態/テーマ/提案/人が混在」への対処として、
          テーマは判断待ちの一覧とは別の「いまの見立て（状態）」に位置付ける。 */}
      <ThemesPanel
        themes={themes}
        themesLoaded={themesLoaded}
        goals={goals}
        refreshThemes={refreshThemes}
        refreshRuns={refreshRuns}
        onNavigate={(path) => navigate(path)}
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
              await fetch(`/api/agents/pending-unmasked/${encodeURIComponent(confirmingUnmasked.id)}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "dismiss" }),
              });
              await refreshRuns();
            } finally {
              setConfirmingUnmaskedBusy(false);
              setConfirmingUnmasked(null);
            }
          }}
          onAllow={async () => {
            setConfirmingUnmaskedBusy(true);
            try {
              await fetch(`/api/agents/pending-unmasked/${encodeURIComponent(confirmingUnmasked.id)}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "confirm" }),
              });
              await refreshRuns();
            } finally {
              setConfirmingUnmaskedBusy(false);
              setConfirmingUnmasked(null);
            }
          }}
          onRegister={async () => {
            setConfirmingUnmaskedBusy(true);
            try {
              await fetch(`/api/agents/pending-unmasked/${encodeURIComponent(confirmingUnmasked.id)}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "confirm", registerNameCandidates: true }),
              });
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
