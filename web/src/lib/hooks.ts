"use client";

import { useCallback, useEffect, useState } from "react";
import type { AgentRun } from "@/components/RunDetail";
import type { Issue, JournalEntry, OrgVitals, Team } from "@/lib/types";

// Dashboard / Issues一覧 / Issue詳細 / Organization Contextの各画面で共通して使う
// ポーリング付きデータ取得フック。画面（ルート）が分かれてもデータ取得ロジックを
// 重複させないための共通化。

function usePolling<T>(url: string, fallback: T, intervalMs: number) {
  const [data, setData] = useState<T>(fallback);

  // 外部（イベントハンドラ）から呼んで即座に再取得＋反映するための関数。
  // useEffect内のpollとは別実装だが、意図的に重複させている
  // （effect本体からsetStateを直接/間接に呼ぶ形にしないため）。
  const refresh = useCallback(async () => {
    try {
      const res = await fetch(url);
      const json = await res.json();
      setData(json);
      return json;
    } catch {
      return null;
    }
  }, [url]);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch(url);
        const json = await res.json();
        if (!cancelled) setData(json);
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
  }, [url, intervalMs]);

  return { data, setData, refresh };
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
  const fallback: OrgVitals = { teams: [], oneOnOneCoverage: { status: "unknown", covered: 0, total: 0, reason: "" } };
  const { data, refresh } = usePolling<OrgVitals>("/api/vitals", fallback, intervalMs);
  return { vitals: data, refreshVitals: refresh };
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
