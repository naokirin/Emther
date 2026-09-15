"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { runFallbackTitle, type AgentRun } from "@/components/RunDetail";
import type { InterpretationEvent } from "@/lib/daily-situation";
import { truncateForTitle, type PendingAgentStart, type PendingUnmaskedSend } from "@/lib/types";
import type {
  EmCheckin,
  EmReflectionNote,
  Issue,
  JournalEntry,
  KnowledgeEvent,
  ObjectiveWithProgress,
  OrgBackgroundEntry,
  OrgStrategy,
  OrgTheme,
  OrgVitals,
  PersonProfile,
  PersonSummary,
  PersonEvaluationLog,
  Report,
  ReportPeriodType,
  RulesAndConstraints,
  Suggestion,
  Team,
  TimelineEntry,
} from "@/lib/types";

// Dashboard / Issues一覧 / Issue詳細 / Organization Contextの各画面で共通して使う
// ポーリング付きデータ取得フック。画面（ルート）が分かれてもデータ取得ロジックを
// 重複させないための共通化。

// enabled=falseの間はfetch自体を一切行わない（例: 対象IDがまだ確定していない画面で、
// 空文字列URLへfetchし続けるような無駄なポーリングを避けるため）。
function usePolling<T>(url: string, fallback: T, intervalMs: number, enabled = true) {
  const [data, setData] = useState<T>(fallback);
  // 初回フェッチが完了したかどうか。fallbackはまだ「サーバーの実データ」ではないため、
  // 「一度だけ実データで編集ドラフトを初期化したい」ような画面（例: /settings）が
  // fallbackを実データと誤認しないように区別できるようにする。
  const [loaded, setLoaded] = useState(false);

  // 外部（イベントハンドラ）から呼んで即座に再取得＋反映するための関数。
  // useEffect内のpollとは別実装だが、意図的に重複させている
  // （effect本体からsetStateを直接/間接に呼ぶ形にしないため）。
  const refresh = useCallback(async () => {
    if (!enabled) return null;
    try {
      const res = await fetch(url);
      const json = await res.json();
      setData(json);
      setLoaded(true);
      return json;
    } catch {
      return null;
    }
  }, [url, enabled]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch(url);
        const json = await res.json();
        if (!cancelled) {
          setData(json);
          setLoaded(true);
        }
      } catch {
        // ポーリング失敗は静かに無視し、次回のポーリングに任せる
      }
    }

    const interval = setInterval(poll, intervalMs);
    void poll();
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [url, intervalMs, enabled]);

  return { data, setData, loaded, refresh };
}

// 改修依頼「一覧⇄詳細をNotionのようなサイドピークで」対応。詳細をモーダル遷移ではなく
// クエリパラメータ（例: ?issue=<id>）で保持する。一覧ページ自身がこの値を読んで
// SlideOverを開閉するだけの軽量な実装（Next.jsのParallel/Intercepting Routesは
// このバージョンでの検証コストを踏まえ見送った——docs/em_ui_ux_issue.md関連の設計判断）。
// URLに状態が残るためリロードしてもpeekが消えず、ブラウザの戻る/進むでも自然に開閉する。
// 呼び出し側の一覧ページは`useSearchParams`を使うため`<Suspense>`で包む必要がある
// （Next.js公式の要件。issues/page.tsx・journal/page.tsxの既存パターンを踏襲すること）。
export function usePeekParam(key: string) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const id = searchParams.get(key);

  const open = useCallback(
    (nextId: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set(key, nextId);
      router.push(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [key, pathname, router, searchParams],
  );

  const close = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete(key);
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [key, pathname, router, searchParams]);

  return { id, open, close };
}

// 既に提案化されていればその提案へ、まだならその場で提案として残してから遷移する。
export function useGoToRunIssue(issues: Issue[]) {
  const router = useRouter();
  return useCallback(
    async (run: AgentRun) => {
      const existing = issues.find((i) => i.agentRunId === run.id);
      if (existing) {
        router.push(`/suggestions/${existing.id}`);
        return;
      }
      try {
        const res = await fetch("/api/suggestions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: truncateForTitle(runFallbackTitle(run)), agentRunId: run.id }),
        });
        const data = await res.json();
        if (res.ok) router.push(`/suggestions/${data.suggestion.id}`);
      } catch {
        // 失敗時は提案一覧から手動で紐づけられる
      }
    },
    [issues, router],
  );
}

export function useRuns(intervalMs = 1500) {
  const { data, setData, loaded, refresh } = usePolling<{
    runs: AgentRun[];
    pendingAgentStarts: PendingAgentStart[];
    pendingUnmaskedSends: PendingUnmaskedSend[];
  }>("/api/agents", { runs: [], pendingAgentStarts: [], pendingUnmaskedSends: [] }, intervalMs);
  return {
    runs: data.runs,
    pendingAgentStarts: data.pendingAgentStarts ?? [],
    pendingUnmaskedSends: data.pendingUnmaskedSends ?? [],
    setRuns: (runs: AgentRun[]) => setData({ ...data, runs }),
    runsLoaded: loaded,
    refreshRuns: refresh,
  };
}

// ユーザー要望「一覧の全件取得をページネーション化したい」対応。/agents画面のInbox一覧専用。
// useRuns()（全件取得、Fleet状態・Activity Stream用に据え置き）とは別に、フィルタ＋ページ番号を
// クエリパラメータとして都度APIへ渡し、そのページ分のrunsとtotalだけを受け取る。
export function useRunsInbox(filter: { status: string; showDismissed: boolean }, page: number, pageSize: number, intervalMs = 1500) {
  const params = new URLSearchParams();
  if (filter.status) params.set("status", filter.status);
  if (filter.showDismissed) params.set("showDismissed", "1");
  params.set("page", String(page));
  params.set("pageSize", String(pageSize));

  type Result = { runs: AgentRun[]; total: number; page: number; pageSize: number };
  const fallback: Result = { runs: [], total: 0, page: 1, pageSize };
  const { data, loaded, refresh } = usePolling<Result>(`/api/agents/inbox?${params.toString()}`, fallback, intervalMs);
  return { runs: data.runs, total: data.total, inboxLoaded: loaded, refreshInbox: refresh };
}

export function useIssues(intervalMs = 3000) {
  const { data, setData, loaded, refresh } = usePolling<{ issues: Issue[] }>(
    "/api/issues",
    { issues: [] },
    intervalMs,
  );
  return { issues: data.issues, setIssues: (issues: Issue[]) => setData({ issues }), issuesLoaded: loaded, refreshIssues: refresh };
}

// docs/2nd_pivot_version.md Phase 7。Suggestion が第一級。
export function useSuggestions(intervalMs = 3000) {
  const { data, setData, loaded, refresh } = usePolling<{ suggestions: Suggestion[] }>(
    "/api/suggestions",
    { suggestions: [] },
    intervalMs,
  );
  return {
    suggestions: data.suggestions,
    setSuggestions: (suggestions: Suggestion[]) => setData({ suggestions }),
    suggestionsLoaded: loaded,
    refreshSuggestions: refresh,
  };
}

export function useSuggestion(id: string, intervalMs = 2000) {
  const { data, setData, loaded, refresh } = usePolling<{
    suggestion: Suggestion | null;
    sourceJournals?: JournalEntry[];
  }>(`/api/suggestions/${id}`, { suggestion: null, sourceJournals: [] }, intervalMs);
  return {
    suggestion: data.suggestion,
    sourceJournals: data.sourceJournals ?? [],
    setSuggestion: (suggestion: Suggestion | null) => setData((prev) => ({ ...prev, suggestion })),
    suggestionLoaded: loaded,
    refreshSuggestion: refresh,
  };
}

export function useJournal(intervalMs = 5000) {
  const { data, setData, loaded, refresh } = usePolling<{ entries: JournalEntry[] }>(
    "/api/journal",
    { entries: [] },
    intervalMs,
  );
  return {
    journalEntries: data.entries,
    // 改修依頼「ローカルAIの処理を非同期化する」対応。Submit後、ローカルモデルの処理完了を
    // 待つ間もポーリングが走り続けるため、結果を反映する時点でのjournalEntriesは
    // レンダー時にクロージャで捕まえた古い配列になりうる。関数形式の更新も受け付けられる
    // ようにし、常に最新のstateを起点に反映できるようにする。
    setJournalEntries: (entries: JournalEntry[] | ((prev: JournalEntry[]) => JournalEntry[])) =>
      setData((prev) => ({ entries: typeof entries === "function" ? entries(prev.entries) : entries })),
    journalLoaded: loaded,
    refreshJournal: refresh,
  };
}

export function useJournalEntry(id: string | undefined, intervalMs = 10000) {
  const { data, loaded } = usePolling<{ entry: JournalEntry | null }>(
    id ? `/api/journal/${id}` : "/api/journal",
    { entry: null },
    intervalMs,
    !!id,
  );
  return { entry: data.entry, entryLoaded: loaded };
}

// ユーザー要望「一覧の全件取得をページネーション化したい」対応。/journal（一覧・検索画面）
// 専用。useJournal()（全件取得、Dashboard・Organization Context画面のチームVitals集計用に
// 据え置き）とは別に、フィルタ・ページ番号をクエリパラメータとして都度APIへ渡し、
// そのページ分のentries・total・絞り込みドロップダウン用facetsだけを受け取る。
export type JournalSearchFilter = {
  query: string;
  tag: string;
  person: string;
  urgency: string;
  sentiment: string;
  periodDays: string;
  excludeResolved: boolean;
};

export function useJournalSearch(
  filter: JournalSearchFilter,
  page: number,
  pageSize: number,
  focusId: string | null,
  intervalMs = 5000,
) {
  const params = new URLSearchParams();
  if (filter.query) params.set("query", filter.query);
  if (filter.tag) params.set("tag", filter.tag);
  if (filter.person) params.set("person", filter.person);
  if (filter.urgency) params.set("urgency", filter.urgency);
  if (filter.sentiment) params.set("sentiment", filter.sentiment);
  if (filter.periodDays !== "all") params.set("periodDays", filter.periodDays);
  if (filter.excludeResolved) params.set("excludeResolved", "1");
  if (focusId) params.set("focusId", focusId);
  params.set("page", String(page));
  params.set("pageSize", String(pageSize));

  type Result = {
    entries: JournalEntry[];
    total: number;
    page: number;
    pageSize: number;
    facets: { tags: string[]; people: string[] };
  };
  const fallback: Result = { entries: [], total: 0, page: 1, pageSize, facets: { tags: [], people: [] } };
  const { data, setData, loaded, refresh } = usePolling<Result>(`/api/journal/search?${params.toString()}`, fallback, intervalMs);
  return {
    entries: data.entries,
    total: data.total,
    resolvedPage: data.page,
    facets: data.facets,
    // useJournalEditing（Dashboard/journal一覧で共有する編集ロジック）はsetJournalEntriesを
    // 関数形式（前回値を起点に更新）でも呼ぶため、useJournal()の実装と同じ形にしておく。
    setEntries: (entries: JournalEntry[] | ((prev: JournalEntry[]) => JournalEntry[])) =>
      setData((prev) => ({ ...prev, entries: typeof entries === "function" ? entries(prev.entries) : entries })),
    searchLoaded: loaded,
    refreshSearch: refresh,
  };
}

export function useTeams(intervalMs = 5000) {
  const { data, setData, loaded, refresh } = usePolling<{ teams: Team[] }>(
    "/api/teams",
    { teams: [] },
    intervalMs,
  );
  return { teams: data.teams, setTeams: (teams: Team[]) => setData({ teams }), teamsLoaded: loaded, refreshTeams: refresh };
}

export function useVitals(intervalMs = 5000) {
  const fallback: OrgVitals = {
    teams: [],
    oneOnOneCoverage: { status: "unknown", covered: 0, total: 0, reason: "", uncoveredMembers: [] },
  };
  const { data, loaded, refresh } = usePolling<OrgVitals>("/api/vitals", fallback, intervalMs);
  return { vitals: data, vitalsLoaded: loaded, refreshVitals: refresh };
}

export function useOrgStrategy(intervalMs = 8000) {
  const fallback: { strategy: OrgStrategy } = { strategy: { mission: "", vision: "", values: "" } };
  const { data, loaded, refresh } = usePolling<{ strategy: OrgStrategy }>("/api/org/strategy", fallback, intervalMs);
  return { strategy: data.strategy, strategyLoaded: loaded, refreshStrategy: refresh };
}

export function useOrgBackgrounds(intervalMs = 8000) {
  const { data, loaded, refresh } = usePolling<{ backgrounds: OrgBackgroundEntry[] }>(
    "/api/org/background",
    { backgrounds: [] },
    intervalMs,
  );
  return { backgrounds: data.backgrounds, backgroundsLoaded: loaded, refreshBackgrounds: refresh };
}

// docs/memo.md「H. 戦略→Issue→結果の一本線」対応。
export function useObjectives(intervalMs = 5000) {
  const { data, loaded, refresh } = usePolling<{ objectives: ObjectiveWithProgress[] }>("/api/org/objectives", { objectives: [] }, intervalMs);
  return { objectives: data.objectives, objectivesLoaded: loaded, refreshObjectives: refresh };
}

export function useSettingsRules(intervalMs = 8000) {
  const fallback: { rules: RulesAndConstraints } = {
    rules: {
      teamWindowDays: 14,
      minEntriesForJudgement: 2,
      teamBadSentimentMax: -0.34,
      teamWarnSentimentMax: 0.2,
      coverageWindowDays: 30,
      coverageGoodRatio: 0.8,
      coverageWarnRatio: 0.4,
      agentStaleAfterSeconds: 120,
      agentKillAfterSeconds: 600,
      journalFactTtlDays: 90,
      autoAnomalyDetectionEnabled: false,
      autoJournalUrgencyFilter: "high_only",
      autoJournalSentimentFilter: "all",
      autoIssueUpdateAnalysisEnabled: false,
      autoMorningSummaryEnabled: false,
      autoMorningSummaryHour: 7,
      autoDistillationEnabled: false,
      autoDistillationWeekday: 1,
      autoDistillationHour: 8,
      maxParallelAgentRuns: 2,
      perTurnBudgetUsd: 0.5,
      teamParallelKickoffEnabled: true,
      decisionQueueLimit: 3,
      observationQueueLimit: 3,
      staleInterventionDays: 14,
      agentModelTiers: {},
      agentAgyModels: {},
      agentCursorModels: {},
      cliOrder: ["claude"],
      selfPersonId: null,
      localChatModelPreset: "350m",
    },
  };
  const { data, loaded, refresh } = usePolling<{ rules: RulesAndConstraints }>("/api/settings/rules", fallback, intervalMs);
  return { rules: data.rules, rulesLoaded: loaded, refreshRules: refresh };
}

// 単一Issue詳細ページ用。Issue一覧のポーリングとは別に、そのIssue1件だけを取得する。
// docs/memo.md「N. 時系列変化をEMが読む物語に」対応。
export function useTimeline(intervalMs = 10000) {
  const { data, loaded, refresh } = usePolling<{ entries: TimelineEntry[] }>("/api/timeline", { entries: [] }, intervalMs);
  return { entries: data.entries, timelineLoaded: loaded, refreshTimeline: refresh };
}

// docs/memo.md「J. Peopleを第一級ハブに」対応。
export function usePeople(intervalMs = 5000) {
  const { data, loaded, refresh } = usePolling<{ people: PersonSummary[] }>("/api/people", { people: [] }, intervalMs);
  return { people: data.people, peopleLoaded: loaded, refreshPeople: refresh };
}

export function useThemes(intervalMs = 8000) {
  const { data, loaded, refresh } = usePolling<{ themes: OrgTheme[] }>("/api/themes", { themes: [] }, intervalMs);
  return { themes: data.themes, themesLoaded: loaded, refreshThemes: refresh };
}

// docs/2nd_pivot_version.md Phase 1対応。ダッシュボードの「今日の状況」の
// 「過去との比較」で使う、既存の長期解釈（KnowledgeEvent kind:interpretation）。
export function useInterpretations(intervalMs = 15000) {
  const { data, loaded } = usePolling<{ interpretations: InterpretationEvent[] }>(
    "/api/knowledge/interpretations",
    { interpretations: [] },
    intervalMs,
  );
  return { interpretations: data.interpretations, interpretationsLoaded: loaded };
}

export function usePersonProfile(id: string, intervalMs = 5000) {
  const { data, loaded, refresh } = usePolling<{ person: PersonProfile | null }>(`/api/people/${id}`, { person: null }, intervalMs);
  return { person: data.person, personLoaded: loaded, refreshPerson: refresh };
}

export function usePersonEvaluationLogs(personId: string, intervalMs = 8000) {
  const { data, loaded, refresh } = usePolling<{ logs: PersonEvaluationLog[] }>(
    `/api/people/${personId}/evaluation-logs`,
    { logs: [] },
    intervalMs,
    !!personId,
  );
  return { evaluationLogs: data.logs, evaluationLogsLoaded: loaded, refreshEvaluationLogs: refresh };
}

// docs/memo.md「H: Phase 2」対応。Issue/Teamの変更履歴（KnowledgeEvent）を取得する。
// entityIdが未確定（null）の間はfetchしない。
export function useEntityHistory(entityType: "issue" | "team" | "org", entityId: string | null, intervalMs = 5000) {
  const url = `/api/knowledge/events?entityType=${entityType}&entityId=${entityId ?? ""}`;
  const { data, loaded, refresh } = usePolling<{ events: KnowledgeEvent[] }>(url, { events: [] }, intervalMs, entityId !== null);
  return { history: data.events, historyLoaded: loaded, refreshHistory: refresh };
}

// docs/memo.md TODO「Quick Journal、Issue進捗、各種イベントを週次・月次でレポーティングする」対応。
export function useReports(periodType: ReportPeriodType | "" = "", intervalMs = 15000) {
  const url = periodType ? `/api/reports?periodType=${periodType}` : "/api/reports";
  const { data, setData, loaded, refresh } = usePolling<{ reports: Report[] }>(url, { reports: [] }, intervalMs);
  return { reports: data.reports, setReports: (reports: Report[]) => setData({ reports }), reportsLoaded: loaded, refreshReports: refresh };
}

// docs/memo.md TODO「人間EM自体の成長に対する向き合いを作る」対応。
export function useEmCheckins(intervalMs = 15000) {
  const { data, setData, loaded, refresh } = usePolling<{ checkins: EmCheckin[] }>("/api/em-self/checkins", { checkins: [] }, intervalMs);
  return { checkins: data.checkins, setCheckins: (checkins: EmCheckin[]) => setData({ checkins }), checkinsLoaded: loaded, refreshCheckins: refresh };
}

export function useReflectionNotes(intervalMs = 15000) {
  const { data, setData, loaded, refresh } = usePolling<{ notes: EmReflectionNote[] }>(
    "/api/em-self/reflection-notes",
    { notes: [] },
    intervalMs,
  );
  return {
    notes: data.notes,
    setNotes: (notes: EmReflectionNote[]) => setData({ notes }),
    notesLoaded: loaded,
    refreshNotes: refresh,
  };
}
