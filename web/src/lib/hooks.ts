"use client";

import { useCallback, useEffect, useState } from "react";
import type { AgentRun } from "@/components/RunDetail";
import { timestampToDateInputValue } from "@/lib/journal-date-parser";
import type {
  EmCheckin,
  EmReflectionNote,
  Issue,
  IssueImpact,
  JournalEntry,
  KnowledgeEvent,
  ObjectiveWithProgress,
  OrgStrategy,
  OrgVitals,
  PersonProfile,
  PersonSummary,
  Report,
  ReportPeriodType,
  RulesAndConstraints,
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

// docs/memo.md「C. Journalセンシング→行動」対応のその場編集ロジックを、Dashboardと
// Journal一覧（TODO「Quick Journalをリスト確認・検索できる画面を追加する」）の両方で
// 共有するための共通フック。同時に編集できるのは呼び出し側の画面ごとに1件のみ。
export function useJournalEditing(journalEntries: JournalEntry[], setJournalEntries: (entries: JournalEntry[]) => void) {
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [editTags, setEditTags] = useState("");
  const [editPeople, setEditPeople] = useState("");
  const [editUrgency, setEditUrgency] = useState<JournalEntry["urgency"]>("mid");
  // docs/em_human_story_and_ux.md 改修依頼「まとめ入力・通常投入どちらでも日付レベルの
  // 訂正を扱えるように」対応。"YYYY-MM-DD"（<input type="date">の値）で保持する。
  const [editDate, setEditDate] = useState("");
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // docs/em_human_story_and_ux.md 改修依頼「urgency:highのまま解決済みにできない」対応。
  // Issueの起票・メモでの解決も、通常の確定と同じくその時点のtags/people/urgency/日付の
  // 編集内容を一緒に反映する（別のフォームとして分離すると二度手間になるため）。
  const [resolutionNoteDraft, setResolutionNoteDraft] = useState("");

  function startEditing(entry: JournalEntry) {
    setEditingEntryId(entry.id);
    setEditTags(entry.tags.join(", "));
    setEditPeople(entry.people.join(", "));
    setEditUrgency(entry.urgency);
    setEditDate(timestampToDateInputValue(entry.createdAt));
    setResolutionNoteDraft(entry.resolutionNote ?? "");
    setEditError(null);
  }

  function cancelEditing() {
    setEditingEntryId(null);
  }

  function currentEditPatch() {
    return {
      tags: editTags.split(",").map((t) => t.trim()).filter(Boolean),
      people: editPeople.split(",").map((p) => p.trim()).filter(Boolean),
      urgency: editUrgency,
      occurredAtDate: editDate || undefined,
    };
  }

  async function patchEntry(entryId: string, extra: Record<string, unknown> = {}) {
    setEditSubmitting(true);
    setEditError(null);
    try {
      const res = await fetch(`/api/journal/${entryId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...currentEditPatch(), ...extra }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "更新に失敗しました");
      // 修正はsupersedesで新しいイベント（＝新しいid）として記録されるため、
      // 古いエントリを新しい内容へ置き換える（一覧の並び順は変えない）。
      setJournalEntries(journalEntries.map((e) => (e.id === entryId ? data.entry : e)));
      return data.entry as JournalEntry;
    } catch (err) {
      setEditError((err as Error).message);
      return undefined;
    } finally {
      setEditSubmitting(false);
    }
  }

  async function confirmEdit(entryId: string) {
    const entry = await patchEntry(entryId);
    if (entry) setEditingEntryId(null);
  }

  // 「メモを残して解決にする」: Issue化するほどではないが、この件はもう追いかけなくてよい、
  // という判断をJournal自体に記録する。urgencyは書き換えない（起きた出来事の深刻さの記録は
  // そのまま残す）。
  async function resolveWithNote(entryId: string) {
    const note = resolutionNoteDraft.trim();
    if (!note) {
      setEditError("解決メモを入力してください");
      return;
    }
    const entry = await patchEntry(entryId, { resolutionNote: note });
    if (entry) setEditingEntryId(null);
  }

  // 「Issueを起票してこの件を追跡する」: 新規Issueを作成し、そのIssueへ紐付ける。
  // 既存のPOST /api/issuesを1回叩くだけで、新しい起票経路は増やさない。作成後の
  // Why/What/Howの深掘りはIssue Workspace側で行う想定のため、ここでは呼び出し元が
  // 新しいIssueのidへ遷移できるよう返す。
  async function resolveWithNewIssue(entry: JournalEntry): Promise<string | undefined> {
    setEditSubmitting(true);
    setEditError(null);
    try {
      const issueRes = await fetch("/api/issues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: (entry.summary || entry.rawText).slice(0, 60),
          why: entry.rawText,
          tags: editTags.split(",").map((t) => t.trim()).filter(Boolean),
        }),
      });
      const issueData = await issueRes.json();
      if (!issueRes.ok) throw new Error(issueData.error ?? "Issueの起票に失敗しました");

      const updated = await patchEntry(entry.id, { resolvedIssueId: issueData.issue.id });
      if (!updated) return undefined;
      setEditingEntryId(null);
      return issueData.issue.id as string;
    } catch (err) {
      setEditError((err as Error).message);
      return undefined;
    } finally {
      setEditSubmitting(false);
    }
  }

  // 解決状態の取り消し（誤ってIssue化/メモした場合の巻き戻し）。
  async function clearResolution(entryId: string) {
    await patchEntry(entryId, { resolvedIssueId: null, resolutionNote: null });
  }

  return {
    editingEntryId,
    editTags,
    setEditTags,
    editPeople,
    setEditPeople,
    editUrgency,
    setEditUrgency,
    editDate,
    setEditDate,
    editSubmitting,
    editError,
    startEditing,
    cancelEditing,
    confirmEdit,
    resolutionNoteDraft,
    setResolutionNoteDraft,
    resolveWithNote,
    resolveWithNewIssue,
    clearResolution,
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
  const fallback: { strategy: OrgStrategy } = { strategy: { mission: "", vision: "", values: "" } };
  const { data, refresh } = usePolling<{ strategy: OrgStrategy }>("/api/org/strategy", fallback, intervalMs);
  return { strategy: data.strategy, refreshStrategy: refresh };
}

// docs/memo.md「H. 戦略→Issue→結果の一本線」対応。
export function useObjectives(intervalMs = 5000) {
  const { data, refresh } = usePolling<{ objectives: ObjectiveWithProgress[] }>("/api/org/objectives", { objectives: [] }, intervalMs);
  return { objectives: data.objectives, refreshObjectives: refresh };
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
// docs/memo.md「N. 時系列変化をEMが読む物語に」対応。
export function useTimeline(intervalMs = 10000) {
  const { data, refresh } = usePolling<{ entries: TimelineEntry[] }>("/api/timeline", { entries: [] }, intervalMs);
  return { entries: data.entries, refreshTimeline: refresh };
}

// docs/memo.md「J. Peopleを第一級ハブに」対応。
export function usePeople(intervalMs = 5000) {
  const { data, refresh } = usePolling<{ people: PersonSummary[] }>("/api/people", { people: [] }, intervalMs);
  return { people: data.people, refreshPeople: refresh };
}

export function usePersonProfile(id: string, intervalMs = 5000) {
  const { data, refresh } = usePolling<{ person: PersonProfile | null }>(`/api/people/${id}`, { person: null }, intervalMs);
  return { person: data.person, refreshPerson: refresh };
}

// docs/memo.md「L. 介入の閉ループ」対応。アーカイブ済み・チーム紐付き済みのIssue
// でのみ意味を持つため、呼び出し側がenabledで制御する（無駄なポーリングを避ける）。
export function useIssueImpact(id: string, enabled: boolean, intervalMs = 10000) {
  const { data, refresh } = usePolling<{ impact: IssueImpact | null }>(`/api/issues/${id}/impact`, { impact: null }, intervalMs, enabled);
  return { impact: data.impact, refreshImpact: refresh };
}

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
export function useEntityHistory(entityType: "issue" | "team" | "org", entityId: string | null, intervalMs = 5000) {
  const url = `/api/knowledge/events?entityType=${entityType}&entityId=${entityId ?? ""}`;
  const { data, refresh } = usePolling<{ events: KnowledgeEvent[] }>(url, { events: [] }, intervalMs, entityId !== null);
  return { history: data.events, refreshHistory: refresh };
}

// docs/memo.md TODO「Quick Journal、Issue進捗、各種イベントを週次・月次でレポーティングする」対応。
export function useReports(periodType: ReportPeriodType | "" = "", intervalMs = 15000) {
  const url = periodType ? `/api/reports?periodType=${periodType}` : "/api/reports";
  const { data, setData, refresh } = usePolling<{ reports: Report[] }>(url, { reports: [] }, intervalMs);
  return { reports: data.reports, setReports: (reports: Report[]) => setData({ reports }), refreshReports: refresh };
}

// docs/memo.md TODO「人間EM自体の成長に対する向き合いを作る」対応。
export function useEmCheckins(intervalMs = 15000) {
  const { data, setData, refresh } = usePolling<{ checkins: EmCheckin[] }>("/api/em-self/checkins", { checkins: [] }, intervalMs);
  return { checkins: data.checkins, setCheckins: (checkins: EmCheckin[]) => setData({ checkins }), refreshCheckins: refresh };
}

export function useReflectionNotes(intervalMs = 15000) {
  const { data, setData, refresh } = usePolling<{ notes: EmReflectionNote[] }>(
    "/api/em-self/reflection-notes",
    { notes: [] },
    intervalMs,
  );
  return {
    notes: data.notes,
    setNotes: (notes: EmReflectionNote[]) => setData({ notes }),
    refreshNotes: refresh,
  };
}
