"use client";

import { useCallback, useEffect, useState } from "react";
import type { AgentRun } from "@/components/RunDetail";
import type { Issue, JournalEntry, KnowledgeEvent, OrgStrategy, OrgVitals, RulesAndConstraints, Team } from "@/lib/types";

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

export function useRuns(intervalMs = 1500) {
  const { data, setData, refresh } = usePolling<{ runs: AgentRun[] }>(
    "/api/agents",
    { runs: [] },
    intervalMs,
  );
  return { runs: data.runs, setRuns: (runs: AgentRun[]) => setData({ runs }), refreshRuns: refresh };
}

export function useIssues(intervalMs = 3000) {
  const { data, setData, refresh } = usePolling<{ issues: Issue[] }>(
    "/api/issues",
    { issues: [] },
    intervalMs,
  );
  return { issues: data.issues, setIssues: (issues: Issue[]) => setData({ issues }), refreshIssues: refresh };
}

export function useJournal(intervalMs = 5000) {
  const { data, setData, refresh } = usePolling<{ entries: JournalEntry[] }>(
    "/api/journal",
    { entries: [] },
    intervalMs,
  );
  return {
    journalEntries: data.entries,
    setJournalEntries: (entries: JournalEntry[]) => setData({ entries }),
    refreshJournal: refresh,
  };
}

export function useTeams(intervalMs = 5000) {
  const { data, setData, refresh } = usePolling<{ teams: Team[] }>(
    "/api/teams",
    { teams: [] },
    intervalMs,
  );
  return { teams: data.teams, setTeams: (teams: Team[]) => setData({ teams }), refreshTeams: refresh };
}

export function useVitals(intervalMs = 5000) {
  const fallback: OrgVitals = {
    teams: [],
    oneOnOneCoverage: { status: "unknown", covered: 0, total: 0, reason: "", uncoveredMembers: [] },
  };
  const { data, refresh } = usePolling<OrgVitals>("/api/vitals", fallback, intervalMs);
  return { vitals: data, refreshVitals: refresh };
}

export function useOrgStrategy(intervalMs = 8000) {
  const fallback: { strategy: OrgStrategy } = { strategy: { mission: "", vision: "", values: "", okr: "" } };
  const { data, refresh } = usePolling<{ strategy: OrgStrategy }>("/api/org/strategy", fallback, intervalMs);
  return { strategy: data.strategy, refreshStrategy: refresh };
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
      agyFallbackAgents: [],
      cursorFallbackAgents: [],
      autoAnomalyDetectionEnabled: false,
      autoMorningSummaryEnabled: false,
      autoMorningSummaryHour: 7,
    },
  };
  const { data, loaded, refresh } = usePolling<{ rules: RulesAndConstraints }>("/api/settings/rules", fallback, intervalMs);
  return { rules: data.rules, rulesLoaded: loaded, refreshRules: refresh };
}

// 単一Issue詳細ページ用。Issue一覧のポーリングとは別に、そのIssue1件だけを取得する。
export function useIssue(id: string, intervalMs = 2000) {
  const { data, setData, refresh } = usePolling<{ issue: Issue | null }>(
    `/api/issues/${id}`,
    { issue: null },
    intervalMs,
  );
  return { issue: data.issue, setIssue: (issue: Issue | null) => setData({ issue }), refreshIssue: refresh };
}

// docs/memo.md「H: Phase 2」対応。Issue/Teamの変更履歴（KnowledgeEvent）を取得する。
// entityIdが未確定（null）の間はfetchしない。
export function useEntityHistory(entityType: "issue" | "team", entityId: string | null, intervalMs = 5000) {
  const url = `/api/knowledge/events?entityType=${entityType}&entityId=${entityId ?? ""}`;
  const { data, refresh } = usePolling<{ events: KnowledgeEvent[] }>(url, { events: [] }, intervalMs, entityId !== null);
  return { history: data.events, refreshHistory: refresh };
}
