// TanStack Query ベースのポーリング GET（Hono RPC / @emther/api-contract）。
// - ポーリングは refetchInterval（間隔ms・enabled）。
// - 楽観的更新は呼び出し側が useQueryClient().setQueryData(queryKey, ...) を直接呼ぶ（フック側に個別 setter は持たない）。
// - 初回完了は !isPending。data 初期値は undefined（呼び出し側で data?.xxx ?? []）。
// - 失敗は Query 既定のリトライに任せ、明示エラー UI が必要な画面のみ query.isError を見る。
// - queryKey は ["api", ...pathセグメント, ...パラメータ] で invalidateQueries を URL 単位に揃える。
import { useCallback } from "react";
import { useQuery, useQueryClient, type UseQueryOptions } from "@tanstack/react-query";
import type {
  AgentsInboxResponse,
  AgentsResponse,
  EmCheckinsResponse,
  GoalsResponse,
  GrowSuggestionsResponse,
  JournalBatchStatusResponse,
  JournalEntryResponse,
  JournalListResponse,
  JournalSearchResponse,
  KnowledgeEventsResponse,
  OrgBackgroundsResponse,
  OrgStrategyResponse,
  PeopleResponse,
  PersonEvaluationLogsResponse,
  PersonProfileResponse,
  PoliciesResponse,
  ReflectionNotesResponse,
  ReportsResponse,
  SettingsRulesResponse,
  SuggestionDetailResponse,
  SuggestionMutationResponse,
  SuggestionsResponse,
  TeamsResponse,
  ThemesResponse,
  TimelineResponse,
  VitalsResponse,
} from "@emther/api-contract";
import { api, rpcJsonAs } from "./api-client";
import type { AgentRun } from "@emther/core/agent-runtime";
import { runFallbackTitle } from "../components/runDetailMeta";
import { useSuggestionPeek } from "../components/useSuggestionPeek";
import { truncateForTitle } from "@emther/core/types";
import type {
  JournalEntry,
  OrgStrategy,
  OrgVitals,
  ReportPeriodType,
  RulesAndConstraints,
  Suggestion,
} from "@emther/core/types";

function usePolledRpc<T>(
  queryKey: readonly unknown[],
  queryFn: () => Promise<T>,
  intervalMs: number,
  options?: Pick<UseQueryOptions<T>, "enabled">,
) {
  return useQuery<T>({
    queryKey,
    queryFn,
    refetchInterval: intervalMs,
    enabled: options?.enabled,
  });
}

export function useTimeline(intervalMs = 10000) {
  const query = usePolledRpc(
    ["api", "timeline"],
    async () => rpcJsonAs<TimelineResponse>(await api.api.timeline.$get(), "GET /api/timeline"),
    intervalMs,
  );
  return {
    entries: query.data?.entries ?? [],
    timelineLoaded: !query.isPending,
    refreshTimeline: query.refetch,
  };
}

// 楽観的更新は呼び出し側が queryClient.setQueryData(emCheckinsQueryKey, ...) を直接呼ぶ。
export const emCheckinsQueryKey = ["api", "em-self", "checkins"] as const;

export function useEmCheckins(intervalMs = 15000) {
  const query = usePolledRpc(
    emCheckinsQueryKey,
    async () => rpcJsonAs<EmCheckinsResponse>(await api.api["em-self"].checkins.$get(), "GET /api/em-self/checkins"),
    intervalMs,
  );
  return {
    checkins: query.data?.checkins ?? [],
    checkinsLoaded: !query.isPending,
    refreshCheckins: query.refetch,
  };
}

// 楽観的更新は呼び出し側が setQueryData を直接呼ぶ（useEmCheckins と同じ）。
export const reflectionNotesQueryKey = ["api", "em-self", "reflection-notes"] as const;

export function useReflectionNotes(intervalMs = 15000) {
  const query = usePolledRpc(
    reflectionNotesQueryKey,
    async () =>
      rpcJsonAs<ReflectionNotesResponse>(await api.api["em-self"]["reflection-notes"].$get(), "GET /api/em-self/reflection-notes"),
    intervalMs,
  );
  return {
    notes: query.data?.notes ?? [],
    notesLoaded: !query.isPending,
    refreshNotes: query.refetch,
  };
}

// 呼び出し側は refreshTeams() のみ使うためセッターは用意しない。
export function useTeams(intervalMs = 5000) {
  const query = usePolledRpc(
    ["api", "teams"],
    async () => rpcJsonAs<TeamsResponse>(await api.api.teams.$get(), "GET /api/teams"),
    intervalMs,
  );
  return {
    teams: query.data?.teams ?? [],
    teamsLoaded: !query.isPending,
    // TeamCreatePanel/TeamEditPanelは`refreshTeams: () => Promise<void>`という
    // 素朴な型で受け取るため、`refetch`の戻り値（QueryObserverResult）は握りつぶす。
    refreshTeams: async () => {
      await query.refetch();
    },
  };
}

export function useJournal(intervalMs = 5000) {
  const query = usePolledRpc(
    ["api", "journal"],
    async () => rpcJsonAs<JournalListResponse>(await api.api.journal.$get(), "GET /api/journal"),
    intervalMs,
  );
  return {
    journalEntries: query.data?.entries ?? [],
    journalLoaded: !query.isPending,
    refreshJournal: query.refetch,
  };
}

// useJournalEditing が setJournalEntries を関数形式でも呼ぶため、このフックだけは setEntries を維持する。
export type JournalSearchFilter = {
  query: string;
  tag: string;
  person: string;
  urgency: string;
  sentiment: string;
  periodDays: string;
  excludeResolved: boolean;
  includeArchived: boolean;
  quarantinedOnly: boolean;
  includeSensitive: boolean;
};

export function useJournalSearch(
  filter: JournalSearchFilter,
  page: number,
  pageSize: number,
  focusId: string | null,
  intervalMs = 5000,
) {
  const fallback: JournalSearchResponse = { entries: [], total: 0, page: 1, pageSize, facets: { tags: [], people: [] } };
  const queryKey = ["api", "journal", "search", filter, page, pageSize, focusId] as const;
  const queryClient = useQueryClient();
  const query = usePolledRpc(
    queryKey,
    async () =>
      rpcJsonAs<JournalSearchResponse>(
        await api.api.journal.search.$get({
          query: {
            ...(filter.query ? { query: filter.query } : {}),
            ...(filter.tag ? { tag: filter.tag } : {}),
            ...(filter.person ? { person: filter.person } : {}),
            ...(filter.urgency ? { urgency: filter.urgency } : {}),
            ...(filter.sentiment ? { sentiment: filter.sentiment } : {}),
            ...(filter.periodDays !== "all" ? { periodDays: filter.periodDays } : {}),
            ...(filter.excludeResolved ? { excludeResolved: "1" } : {}),
            ...(filter.includeArchived ? { includeArchived: "1" } : {}),
            ...(filter.quarantinedOnly ? { quarantinedOnly: "1" } : {}),
            ...(filter.includeSensitive ? { includeSensitive: "1" } : {}),
            ...(focusId ? { focusId } : {}),
            page: String(page),
            pageSize: String(pageSize),
          },
        }),
        "GET /api/journal/search",
      ),
    intervalMs,
  );
  const data = query.data ?? fallback;

  return {
    entries: data.entries,
    total: data.total,
    resolvedPage: data.page,
    facets: data.facets,
    setEntries: (entries: JournalEntry[] | ((prev: JournalEntry[]) => JournalEntry[])) =>
      queryClient.setQueryData<JournalSearchResponse>(queryKey, (prev) => {
        const base = prev ?? fallback;
        return { ...base, entries: typeof entries === "function" ? entries(base.entries) : entries };
      }),
    searchLoaded: !query.isPending,
    refreshSearch: async () => {
      await query.refetch();
    },
  };
}

/** 未解釈件数で集約解釈ストリップを出し分け */
export const journalBatchStatusQueryKey = ["api", "journal", "batch"] as const;

export function useJournalBatchStatus(intervalMs = 15000) {
  const query = usePolledRpc(
    journalBatchStatusQueryKey,
    async () => rpcJsonAs<JournalBatchStatusResponse>(await api.api.journal.batch.$get(), "GET /api/journal/batch"),
    intervalMs,
  );
  return {
    pendingCount: query.data?.pendingCount ?? 0,
    batchStatusLoaded: !query.isPending,
    refreshBatchStatus: query.refetch,
  };
}

// settings 画面はロード完了前に draft を初期化するため既定値 fallback を維持する。
const SETTINGS_RULES_FALLBACK: RulesAndConstraints = {
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
  autoSuggestionUpdateAnalysisEnabled: false,
  autoMorningSummaryEnabled: false,
  autoMorningSummaryHour: 7,
  autoJournalBatchEnabled: false,
  autoJournalBatchHours: [7],
  autoDistillationEnabled: false,
  autoDistillationWeekdays: [1],
  autoDistillationHour: 8,
  autoGrowEnabled: false,
  autoGrowWeekday: 1,
  autoGrowHour: 8,
  autoWeeklyReportEnabled: false,
  autoWeeklyReportWeekday: 1,
  autoWeeklyReportHour: 8,
  autoMonthlyReportEnabled: false,
  autoMonthlyReportDay: 1,
  autoMonthlyReportHour: 8,
  maxParallelAgentRuns: 2,
  perTurnBudgetUsd: 0.5,
  teamParallelKickoffEnabled: true,
  decisionQueueLimit: 3,
  observationQueueLimit: 3,
  staleInterventionDays: 14,
  agentModelTiers: {},
  agentAgyModels: {},
  agentCursorModels: {},
  referenceLookupClaudeModel: "",
  referenceLookupCursorModel: "",
  cliOrder: ["claude"],
  selfPersonId: null,
  localChatModelPreset: "1.2b-jp",
  localRerankEnabled: false,
};

export function useSettingsRules(intervalMs = 8000) {
  const query = usePolledRpc(
    ["api", "settings", "rules"],
    async () => rpcJsonAs<SettingsRulesResponse>(await api.api.settings.rules.$get(), "GET /api/settings/rules"),
    intervalMs,
  );
  return {
    rules: query.data?.rules ?? SETTINGS_RULES_FALLBACK,
    rulesLoaded: !query.isPending,
    refreshRules: async () => {
      await query.refetch();
    },
  };
}

// 呼び出し側は refreshPeople: () => Promise<void> | void のため、refetch の戻り値を握りつぶす。
export function usePeople(intervalMs = 5000) {
  const query = usePolledRpc(
    ["api", "people"],
    async () => rpcJsonAs<PeopleResponse>(await api.api.people.$get(), "GET /api/people"),
    intervalMs,
  );
  return {
    people: query.data?.people ?? [],
    peopleLoaded: !query.isPending,
    refreshPeople: async () => {
      await query.refetch();
    },
  };
}

export function usePersonProfile(id: string, intervalMs = 5000) {
  const query = usePolledRpc(
    ["api", "people", id],
    async () => rpcJsonAs<PersonProfileResponse>(await api.api.people[":id"].$get({ param: { id } }), `GET /api/people/${id}`),
    intervalMs,
  );
  return {
    person: query.data?.person ?? null,
    personLoaded: !query.isPending,
    refreshPerson: async () => {
      await query.refetch();
    },
  };
}

export function usePersonEvaluationLogs(personId: string, intervalMs = 8000) {
  const query = usePolledRpc(
    ["api", "people", personId, "evaluation-logs"],
    async () =>
      rpcJsonAs<PersonEvaluationLogsResponse>(
        await api.api.people[":id"]["evaluation-logs"].$get({ param: { id: personId } }),
        `GET /api/people/${personId}/evaluation-logs`,
      ),
    intervalMs,
    { enabled: !!personId },
  );
  return {
    evaluationLogs: query.data?.logs ?? [],
    evaluationLogsLoaded: !query.isPending,
    refreshEvaluationLogs: async () => {
      await query.refetch();
    },
  };
}

export function useGoals(intervalMs = 5000) {
  const query = usePolledRpc(
    ["api", "org", "goals"],
    async () => rpcJsonAs<GoalsResponse>(await api.api.org.goals.$get(), "GET /api/org/goals"),
    intervalMs,
  );
  return {
    goals: query.data?.goals ?? [],
    goalsLoaded: !query.isPending,
    refreshGoals: async () => {
      await query.refetch();
    },
  };
}

export function useOrgBackgrounds(intervalMs = 8000) {
  const query = usePolledRpc(
    ["api", "org", "background"],
    async () => rpcJsonAs<OrgBackgroundsResponse>(await api.api.org.background.$get(), "GET /api/org/background"),
    intervalMs,
  );
  return {
    backgrounds: query.data?.backgrounds ?? [],
    backgroundsLoaded: !query.isPending,
    refreshBackgrounds: async () => {
      await query.refetch();
    },
  };
}

const ORG_STRATEGY_FALLBACK: OrgStrategy = { mission: "", vision: "", values: "" };

export function useOrgStrategy(intervalMs = 8000) {
  const query = usePolledRpc(
    ["api", "org", "strategy"],
    async () => rpcJsonAs<OrgStrategyResponse>(await api.api.org.strategy.$get(), "GET /api/org/strategy"),
    intervalMs,
  );
  return {
    strategy: query.data?.strategy ?? ORG_STRATEGY_FALLBACK,
    strategyLoaded: !query.isPending,
    refreshStrategy: async () => {
      await query.refetch();
    },
  };
}

export function usePolicies(intervalMs = 8000) {
  const query = usePolledRpc(
    ["api", "org", "policies"],
    async () => rpcJsonAs<PoliciesResponse>(await api.api.org.policies.$get(), "GET /api/org/policies"),
    intervalMs,
  );
  return {
    policies: query.data?.policies ?? [],
    policiesLoaded: !query.isPending,
    refreshPolicies: async () => {
      await query.refetch();
    },
  };
}

export function useThemes(intervalMs = 8000) {
  const query = usePolledRpc(
    ["api", "themes"],
    async () => rpcJsonAs<ThemesResponse>(await api.api.themes.$get(), "GET /api/themes"),
    intervalMs,
  );
  return {
    themes: query.data?.themes ?? [],
    themesLoaded: !query.isPending,
    refreshThemes: async () => {
      await query.refetch();
    },
  };
}

// 楽観的更新は呼び出し側が queryClient.setQueryData(reportsQueryKey(...), ...) を直接呼ぶ。
export function reportsQueryKey(periodType: ReportPeriodType | "") {
  return ["api", "reports", periodType] as const;
}

export function useReports(periodType: ReportPeriodType | "" = "", intervalMs = 15000) {
  const query = usePolledRpc(
    reportsQueryKey(periodType),
    async () =>
      rpcJsonAs<ReportsResponse>(
        await api.api.reports.$get({
          query: periodType ? { periodType } : {},
        }),
        "GET /api/reports",
      ),
    intervalMs,
  );
  return {
    reports: query.data?.reports ?? [],
    reportsLoaded: !query.isPending,
    refreshReports: async () => {
      await query.refetch();
    },
  };
}

// 楽観的更新は呼び出し側が queryClient.setQueryData(growSuggestionsQueryKey, ...) を直接呼ぶ。
export const growSuggestionsQueryKey = ["api", "growth", "suggestions"] as const;

export function useGrowSuggestions(intervalMs = 15000) {
  const query = usePolledRpc(
    growSuggestionsQueryKey,
    async () => rpcJsonAs<GrowSuggestionsResponse>(await api.api.growth.suggestions.$get(), "GET /api/growth/suggestions"),
    intervalMs,
  );
  return {
    growSuggestions: query.data?.suggestions ?? [],
    growSuggestionsLoaded: !query.isPending,
    // GrowSuggestionsPanel が生成完了直後に sourceRunId 一致件数を数えるため、
    // refetch 結果から { suggestions } 形を返す。
    refreshGrowSuggestions: async () => {
      const result = await query.refetch();
      return result.data;
    },
  };
}

// AgentRun 型の正本は @emther/core/agent-runtime。レスポンスエンベロープは api-contract。
export function useRuns(intervalMs = 1500) {
  const query = usePolledRpc(
    ["api", "agents"],
    async () => rpcJsonAs<AgentsResponse>(await api.api.agents.$get(), "GET /api/agents"),
    intervalMs,
  );
  return {
    runs: (query.data?.runs ?? []) as AgentRun[],
    pendingAgentStarts: query.data?.pendingAgentStarts ?? [],
    pendingUnmaskedSends: query.data?.pendingUnmaskedSends ?? [],
    runsLoaded: !query.isPending,
    refreshRuns: async () => {
      await query.refetch();
    },
  };
}

// 既に提案化されていればその提案へ、まだならその場で提案として残してから遷移する。
// ポーリングを持たないコールバックのみのため useQueryClient は使わない。
export function useGoToRunSuggestion(suggestions: Suggestion[]) {
  const peek = useSuggestionPeek();
  return useCallback(
    async (run: AgentRun) => {
      const existing = suggestions.find((s) => s.agentRunId === run.id);
      if (existing) {
        peek.open(existing.id);
        return;
      }
      try {
        const data = await rpcJsonAs<SuggestionMutationResponse>(
          await api.api.suggestions.$post({
            json: { title: truncateForTitle(runFallbackTitle(run)), agentRunId: run.id },
          }),
          "POST /api/suggestions",
        );
        peek.open(data.suggestion.id);
      } catch {
        // 失敗時は提案一覧から手動で紐づけられる
      }
    },
    [suggestions, peek],
  );
}

// /agents の Inbox 一覧専用。useRuns()（全件・Fleet/Activity用）とは別に、
// フィルタ＋ページ番号でそのページ分の runs と total だけを受け取る。
export function useRunsInbox(filter: { status: string; showDismissed: boolean }, page: number, pageSize: number, intervalMs = 1500) {
  const query = usePolledRpc(
    ["api", "agents", "inbox", filter, page, pageSize],
    async () =>
      rpcJsonAs<AgentsInboxResponse>(
        await api.api.agents.inbox.$get({
          query: {
            ...(filter.status ? { status: filter.status } : {}),
            ...(filter.showDismissed ? { showDismissed: "1" } : {}),
            page: String(page),
            pageSize: String(pageSize),
          },
        }),
        "GET /api/agents/inbox",
      ),
    intervalMs,
  );
  return {
    runs: (query.data?.runs ?? []) as AgentRun[],
    total: query.data?.total ?? 0,
    inboxLoaded: !query.isPending,
    refreshInbox: async () => {
      await query.refetch();
    },
  };
}

// id が未確定（undefined）の間は fetch しない。
export function useJournalEntry(id: string | undefined, intervalMs = 10000) {
  const query = usePolledRpc(
    ["api", "journal", id ?? null],
    async () => {
      if (!id) throw new Error("journal id is required");
      return rpcJsonAs<JournalEntryResponse>(await api.api.journal[":id"].$get({ param: { id } }), `GET /api/journal/${id}`);
    },
    intervalMs,
    { enabled: !!id },
  );
  return { entry: query.data?.entry ?? null, entryLoaded: !query.isPending };
}

const VITALS_FALLBACK: OrgVitals = {
  teams: [],
  oneOnOneCoverage: { status: "unknown", covered: 0, total: 0, reason: "", uncoveredMembers: [] },
};

export function useVitals(intervalMs = 5000) {
  const query = usePolledRpc(
    ["api", "vitals"],
    async () => rpcJsonAs<VitalsResponse>(await api.api.vitals.$get(), "GET /api/vitals"),
    intervalMs,
  );
  return {
    vitals: query.data ?? VITALS_FALLBACK,
    vitalsLoaded: !query.isPending,
    refreshVitals: async () => {
      await query.refetch();
    },
  };
}

export const suggestionsQueryKey = ["api", "suggestions"] as const;

export function useSuggestions(intervalMs = 3000) {
  const query = usePolledRpc(
    suggestionsQueryKey,
    async () => rpcJsonAs<SuggestionsResponse>(await api.api.suggestions.$get(), "GET /api/suggestions"),
    intervalMs,
  );
  return {
    suggestions: query.data?.suggestions ?? [],
    suggestionsLoaded: !query.isPending,
    refreshSuggestions: async () => {
      await query.refetch();
    },
  };
}

export function useSuggestion(id: string, intervalMs = 2000) {
  const query = usePolledRpc(
    ["api", "suggestions", id],
    async () =>
      rpcJsonAs<SuggestionDetailResponse>(await api.api.suggestions[":id"].$get({ param: { id } }), `GET /api/suggestions/${id}`),
    intervalMs,
  );
  return {
    suggestion: query.data?.suggestion ?? null,
    sourceJournals: query.data?.sourceJournals ?? [],
    suggestionLoaded: !query.isPending,
    refreshSuggestion: async () => {
      await query.refetch();
    },
  };
}

// entityId が未確定（null）の間は fetch しない。
export function useEntityHistory(entityType: "suggestion" | "team" | "org", entityId: string | null, intervalMs = 5000) {
  const query = usePolledRpc(
    ["api", "knowledge", "events", entityType, entityId],
    async () =>
      rpcJsonAs<KnowledgeEventsResponse>(
        await api.api.knowledge.events.$get({
          query: { entityType, entityId: entityId ?? "" },
        }),
        "GET /api/knowledge/events",
      ),
    intervalMs,
    { enabled: entityId !== null },
  );
  return {
    history: query.data?.events ?? [],
    historyLoaded: !query.isPending,
    refreshHistory: query.refetch,
  };
}
