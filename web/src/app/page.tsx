"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./page.module.css";
import { NameCandidateConfirmDialog } from "@/components/NameCandidateConfirmDialog";
import { SetupGapsBanner } from "@/components/dashboard/SetupGapsBanner";
import { DailySituationPanel } from "@/components/dashboard/DailySituationPanel";
import { EveningModeCard } from "@/components/dashboard/EveningModeCard";
import { ThemesPanel } from "@/components/dashboard/ThemesPanel";
import { TodayActionsPanel } from "@/components/dashboard/TodayActionsPanel";
import { JournalDumpPanel } from "@/components/dashboard/JournalDumpPanel";
import { getDayPhase } from "@/lib/dashboard-day-phase";
import { buildNextActions, selectWatchingItems } from "@/lib/dashboard-next-actions";
import { buildDailySituation } from "@/lib/daily-situation";
import {
  useEmCheckins,
  useGoToRunIssue,
  useIssues,
  useJournal,
  useObjectives,
  useOrgStrategy,
  usePeople,
  useRuns,
  useSettingsRules,
  useTeams,
  useThemes,
  useVitals,
} from "@/lib/hooks";
import { useJournalEditing } from "@/lib/useJournalEditing";
import { useNameCandidateConfirm } from "@/lib/useNameCandidateConfirm";
import { isIssueStrategyUnlinked, isRunStale, type IssueStrategyLinkSuggestion, type PendingUnmaskedSend } from "@/lib/types";

export default function DashboardPage() {
  return (
    <Suspense fallback={null}>
      <DashboardPageInner />
    </Suspense>
  );
}

function DashboardPageInner() {
  const router = useRouter();
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
  const { issues, issuesLoaded, refreshIssues } = useIssues();
  const goToRunIssue = useGoToRunIssue(issues);

  // docs/memo.md「今日タブでAIに戦略を提案させている最中にタブを切り替えると結果が消える」
  // 対応。TodayActionsPanelはダッシュボード／書き連ねタブの切り替えでアンマウントされるため、
  // 生成中フラグ・結果をこのコンポーネント（タブ切り替えで不変）側に持たせる。
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
  const { vitals, vitalsLoaded } = useVitals();
  const { journalEntries, setJournalEntries, journalLoaded } = useJournal();
  // 改修依頼「今日の振り返りに、今日記録されていない場合のアラートを出す」対応。
  const { checkins, checkinsLoaded } = useEmCheckins();
  const { rules } = useSettingsRules();
  // docs/memo.md「O. 期初の憲法づくりオンボーディング」対応。
  const { strategy, strategyLoaded } = useOrgStrategy();
  const { teams, teamsLoaded } = useTeams();
  const { objectives, objectivesLoaded } = useObjectives();
  // docs/em_human_story_and_ux.md P1-10対応。People(J)を朝キューにも薄く編入する。
  const { people, peopleLoaded } = usePeople();
  const { themes, themesLoaded, refreshThemes } = useThemes();
  // 初回フェッチ完了前の空fallbackを「未設定／0件／対応不要」と誤表示しないためのゲート。
  // SettingsのrulesLoadedと同じ考え方（usePollingのloaded）。
  const setupLoaded = strategyLoaded && teamsLoaded && objectivesLoaded;
  const nextActionsLoaded = runsLoaded && issuesLoaded && vitalsLoaded && journalLoaded && peopleLoaded;

  // docs/memo.md TODO「動いていると思ったら止まっていた、を防ぐ」対応。statusが"active"のまま
  // ログ更新が閾値以上無いrunをクライアント側で判定し、Fleet/Next Actions/Inboxで警告表示する。
  const staleRunIds = new Set(
    runs.filter((r) => isRunStale(r.status, r.updatedAt, rules.agentStaleAfterSeconds)).map((r) => r.id),
  );

  // journalTextだけはEveningModeCardなどのCTA（prefillJournal）から
  // JournalDumpPanelの入力欄へ外部プリフィルする必要があるため、ここで持つ
  // （他のJournal関連state・ハンドラはJournalDumpPanel側に閉じている）。
  const [journalText, setJournalText] = useState("");

  // ユーザー指摘「今日あったことを書き連ねるも、他画面と同じくタブの一つにしてよい」
  // 対応。「今日」内をダッシュボード／書き連ねの2タブへ分ける。
  const [activeTab, setActiveTab] = useState<"dashboard" | "journal">("dashboard");

  // docs/memo.md「C. Journalセンシング→行動」対応。AI抽出（tags/people/urgency）を
  // EMがその場で校正するための編集モード。同時に編集できるのは1件のみ。
  // ロジック自体はJournal一覧画面（/journal）と共有するため@/lib/hooksに切り出してある。
  const journalEditing = useJournalEditing(journalEntries, setJournalEntries);
  const { fetchWithNameConfirm, nameCandidateDialog } = useNameCandidateConfirm();
  const [confirmingUnmasked, setConfirmingUnmasked] = useState<PendingUnmaskedSend | null>(null);
  const [confirmingUnmaskedBusy, setConfirmingUnmaskedBusy] = useState(false);

  // ユーザー指摘「書き連ねるをタブ化しても、他パネルの『書き連ねる』系CTAは自動で
  // タブ切り替えしてほしい」対応。書き連ねタブへ切り替えてから、描画後に入力欄へ
  // スクロール・フォーカスする。
  function focusJournalInput() {
    setActiveTab("journal");
    requestAnimationFrame(() => {
      const el = document.getElementById("quick-journal-input");
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
      (el as HTMLInputElement | null)?.focus();
    });
  }

  // docs/memo.md「D. 評価不能→観測アクション」対応。評価不能で立ち止まらせず、
  // 「誰の1on1を記録すればよいか」までQuick Journalへのプリフィルで橋渡しする。
  function prefillJournal(text: string) {
    setJournalText(text);
    focusJournalInput();
  }

  // ユーザー指摘「『判断待ちがN件あります』の確認先がわからない」対応。今日の状況の
  // 「判断する価値がありそうなこと」から、実際にその件数の内訳が並ぶ「今日やるべき3つ」
  // まで確実に辿れるようにする。
  function scrollToTodayActions() {
    requestAnimationFrame(() => {
      document.getElementById("today-actions")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  const watchingItems = selectWatchingItems(runs, issues);
  const nextActions = buildNextActions({
    now,
    runs,
    issues,
    journalEntries,
    people,
    vitals,
    pendingAgentStarts,
    pendingUnmaskedSends,
    staleRunIds,
    watchingItems,
    goToRunIssue,
    push: (path) => router.push(path),
    prefillJournal,
    onConfirmUnmasked: setConfirmingUnmasked,
  });

  // docs/2nd_pivot_version.md Phase 1対応。pivot_policy.md「目指すUX」の6項目で
  // 今日の状況をまとめる（Issue駆動ではなく Journal/Vitals/People 駆動）。
  const dailySituation = buildDailySituation({
    now,
    journalEntries,
    vitals,
    people,
    nextActions,
    push: (path: string) => router.push(path),
    prefillJournal,
  });
  const dailySituationLoaded = nextActionsLoaded;

  // docs/em_human_story_and_ux.md P0-4対応。「1日の上限感」をUIで示す（ハード制限はせず、
  // 今日どれだけAIが自動的にRunを起動したかの感覚をEMに持たせる）。
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const autoRunsToday = runs.filter((r) => r.origin !== "manual" && r.createdAt >= todayStart.getTime()).length;

  // 改修依頼「今日の振り返りは、今日記録されていない場合のアラート表示とEMの成長への
  // リンクのみ置く」対応。入力フォーム自体はここには置かず、未記録のときだけ気づかせて
  // /growthへ誘導する（記録は/growthに一本化）。
  const hasCheckinToday = checkins.some((c) => c.createdAt >= todayStart.getTime());

  // docs/em_human_story_and_ux.md P1-10対応。戦略（H）を「ある画面」から朝の要約へ薄く載せる。
  // 判断待ちの項目ではなく単なる現況表示なので、次にすべきことのリストではなくヘッダー直下の
  // 1行として出す。
  const krTotals = objectives
    .flatMap((o) => o.progress)
    .reduce((acc, p) => ({ total: acc.total + p.total }), { total: 0 });

  const dayPhase = getDayPhase(new Date(now).getHours());

  // docs/memo.md「O. 期初の憲法づくりオンボーディング」対応。空の前提のままエージェントが
  // 走らないよう、MVV/Team/Objectiveが揃うまでセットアップ導線を出す。新規ウィザード画面は
  // 増やさず、既存の/orgへの案内に留める（EMが明示的に消せるものではなく、実際に揃うと
  // 自然に消える）。未ロード中は空fallbackを「未設定」と誤認しないよう計算しない。
  const setupGaps: string[] = [];
  if (setupLoaded) {
    if (!strategy.mission && !strategy.vision && !strategy.values) setupGaps.push("MVV未設定");
    if (teams.length === 0) setupGaps.push(`Team ${teams.length}件`);
    if (objectives.length === 0) setupGaps.push(`Objective ${objectives.length}件`);
  }

  const unlinkedParentCount = issues.filter(
    (i) => !i.archived && i.status !== "done" && !i.parentId && isIssueStrategyUnlinked(i),
  ).length;

  return (
    <div className={styles.screen}>
      <SetupGapsBanner
        setupGaps={setupGaps}
        teamsCount={teams.length}
        hasMvv={!!(strategy.mission || strategy.vision || strategy.values)}
        objectivesCount={objectives.length}
        onNavigate={(path) => router.push(path)}
      />

      {/* ユーザー指摘「今日あったことを書き連ねるも、他画面と同じくタブの一つにしてよい」
          対応。ダッシュボード／書き連ねの2タブに分け、他パネルの「書き連ねる」系CTAは
          focusJournalInput側でタブ切り替えまで面倒を見る。 */}
      <div className={styles.tabs}>
        <button
          type="button"
          className={`${styles.tabBtn} ${activeTab === "dashboard" ? styles.tabBtnActive : ""}`}
          onClick={() => setActiveTab("dashboard")}
        >
          ダッシュボード
        </button>
        <button
          type="button"
          className={`${styles.tabBtn} ${activeTab === "journal" ? styles.tabBtnActive : ""}`}
          onClick={() => setActiveTab("journal")}
        >
          書き連ね
        </button>
      </div>

      {activeTab === "dashboard" && (
        <>
          {/* docs/em_ui_ux_issue.md 3節「Evening Mode」対応。終業時だけ、記録し忘れへの気づきと
              記録先（/growth）への導線のみを置く。 */}
          {dayPhase === "evening" && (
            <EveningModeCard
              checkinsLoaded={checkinsLoaded}
              hasCheckinToday={hasCheckinToday}
              onFocusJournal={focusJournalInput}
              onNavigateGrowth={() => router.push("/growth")}
            />
          )}

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
            krTotals={krTotals}
            autoRunsToday={autoRunsToday}
            onNavigate={(path) => router.push(path)}
            issueLinkSuggesting={issueLinkSuggesting}
            issueLinkError={issueLinkError}
            issueLinkPreview={issueLinkPreview}
            issueLinkApplyingId={issueLinkApplyingId}
            onSuggestIssueStrategyLinks={handleSuggestIssueStrategyLinks}
            onAdoptIssueStrategyLink={handleAdoptIssueStrategyLink}
            onDismissIssueLinkPreview={() => setIssueLinkPreview(null)}
            onDismissIssueLinkOne={(issueId) =>
              setIssueLinkPreview((prev) =>
                prev ? { ...prev, suggestions: prev.suggestions.filter((x) => x.issueId !== issueId) } : null,
              )
            }
          />

          {/* ユーザー指摘「チームの状態パネルと今日の状況のチーム表示が被っている」対応。
              独立パネル（旧TeamStatePanel）は廃止し、チーム/メンバーの状態は今日の状況の
              ステータスチップに一本化する（1on1 Coverageもdaily-situation.ts側で統合済み）。 */}
          <DailySituationPanel situation={dailySituation} loaded={dailySituationLoaded} onSeeAllDecisions={scrollToTodayActions} />

          {/* UI/UX見直し（今日タブ）対応。「状態/テーマ/Issue/人が混在」への対処として、
              テーマは判断待ちの一覧とは別の「いまの見立て（状態）」に位置付ける。 */}
          <ThemesPanel
            themes={themes}
            themesLoaded={themesLoaded}
            objectives={objectives}
            refreshThemes={refreshThemes}
            refreshRuns={refreshRuns}
            onNavigate={(path) => router.push(path)}
          />
        </>
      )}

      {activeTab === "journal" && (
        <JournalDumpPanel
          journalText={journalText}
          onJournalTextChange={setJournalText}
          journalEntries={journalEntries}
          setJournalEntries={setJournalEntries}
          journalLoaded={journalLoaded}
          journalEditing={journalEditing}
          fetchWithNameConfirm={fetchWithNameConfirm}
          runs={runs}
          refreshRuns={refreshRuns}
          dayPhase={dayPhase}
          onNavigate={(path) => router.push(path)}
        />
      )}

      {nameCandidateDialog}
      {journalEditing.nameCandidateDialog}
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
