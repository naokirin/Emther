"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { runFallbackTitle, type AgentRun } from "@/components/RunDetail";
import { timestampToDateInputValue } from "@/lib/journal-date-parser";
import { truncateForTitle, type PendingAgentStart, type PendingUnmaskedSend } from "@/lib/types";
import { useNameCandidateConfirm } from "@/lib/useNameCandidateConfirm";
import type {
  EmCheckin,
  EmReflectionNote,
  Issue,
  IssueImpact,
  JournalEntry,
  KnowledgeEvent,
  ObjectiveWithProgress,
  OrgStrategy,
  OrgTheme,
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

// 既にIssue化されていればそのIssueへ、まだならその場でIssue化してから遷移する
// （Issue Workspaceは「Issueの詳細」を表示する画面として一本化しているため）。
// 明示的な「Issueにする」操作からのみ呼ぶこと（P0-2: 即Issue化を既定にしない）。
// ダッシュボード（判断カード表）と/agents（Inbox一覧）の両方から使う共通ロジック。
// 呼び出し側が既に持っているissuesを引数で受け取る（内部でuseIssues()を呼ぶと
// ポーリングが二重になるため）。
export function useGoToRunIssue(issues: Issue[]) {
  const router = useRouter();
  return useCallback(
    async (run: AgentRun) => {
      const existing = issues.find((i) => i.agentRunId === run.id);
      if (existing) {
        router.push(`/issues/${existing.id}`);
        return;
      }
      try {
        const res = await fetch("/api/issues", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: truncateForTitle(runFallbackTitle(run)), agentRunId: run.id }),
        });
        const data = await res.json();
        if (res.ok) router.push(`/issues/${data.issue.id}`);
      } catch {
        // 失敗時はIssue一覧から手動で紐づけられる
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

// docs/memo.md「C. Journalセンシング→行動」対応のその場編集ロジックを、Dashboardと
// Journal一覧（TODO「Quick Journalをリスト確認・検索できる画面を追加する」）の両方で
// 共有するための共通フック。同時に編集できるのは呼び出し側の画面ごとに1件のみ。
export function useJournalEditing(
  journalEntries: JournalEntry[],
  setJournalEntries: (entries: JournalEntry[] | ((prev: JournalEntry[]) => JournalEntry[])) => void,
) {
  const { fetchWithNameConfirm, nameCandidateDialog } = useNameCandidateConfirm();
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  // docs/em_human_story_and_ux.md 改修依頼「Journalの本文を編集できるようにする」対応。
  const [editRawText, setEditRawText] = useState("");
  // 改修依頼「メモ等の保存前にローカルAIが走る処理を非同期化する」対応。本文が実際に
  // 触られた場合だけPATCHにrawTextを含める（毎回含めると、触っていなくても
  // maskForStorage（ローカルNER）が走り、tags/urgency等だけの軽い確定まで重くなってしまう）。
  const [rawTextTouched, setRawTextTouched] = useState(false);
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

  // 改修依頼「メモ等の保存前にローカルAIが走る処理を非同期化し、対象のアイテム部分に
  // スピナーだけ表示する」対応。resolutionNote／rawTextを伴う更新はmaskForStorage
  // （ローカルNER）を通るため数十秒かかることがある。編集フォームでその完了を
  // 待たせず、対象のエントリ自体に「処理中」を示す（他のエントリの編集・閲覧は
  // その間もそのまま行える）。entryIdごとに管理するので、複数件を並行して
  // バックグラウンド処理してもよい。
  const [pendingEntryIds, setPendingEntryIds] = useState<Set<string>>(new Set());
  const [pendingEntryErrors, setPendingEntryErrors] = useState<Record<string, { message: string; retry: () => void }>>(
    {},
  );

  function isEntryPending(entryId: string): boolean {
    // 編集フォームを開いたまま行うclearResolutionのように、フォームを閉じずに
    // 待つ操作もあるため、そのエントリを現在編集中の間はスピナーカードにはしない
    // （フォーム内のeditSubmittingがその間の状態を示す）。
    return pendingEntryIds.has(entryId) && editingEntryId !== entryId;
  }

  function dismissPendingError(entryId: string) {
    setPendingEntryErrors((prev) => {
      if (!(entryId in prev)) return prev;
      const next = { ...prev };
      delete next[entryId];
      return next;
    });
  }

  function startEditing(entry: JournalEntry) {
    setEditingEntryId(entry.id);
    setEditRawText(entry.rawText);
    setRawTextTouched(false);
    setEditTags(entry.tags.join(", "));
    setEditPeople(entry.people.join(", "));
    setEditUrgency(entry.urgency);
    setEditDate(timestampToDateInputValue(entry.createdAt));
    setResolutionNoteDraft(entry.resolutionNote ?? "");
    setEditError(null);
    dismissPendingError(entry.id);
  }

  function cancelEditing() {
    setEditingEntryId(null);
  }

  function currentEditPatch() {
    return {
      rawText: rawTextTouched ? editRawText.trim() || undefined : undefined,
      tags: editTags.split(",").map((t) => t.trim()).filter(Boolean),
      people: editPeople.split(",").map((p) => p.trim()).filter(Boolean),
      urgency: editUrgency,
      occurredAtDate: editDate || undefined,
    };
  }

  // 実際のfetch＋state反映部分。entryIdの「処理中」フラグの出し入れとエラー記録を
  // ここに一本化する。呼び出し側（confirmEdit等）は、編集フォームを閉じてから
  // このawaitを待たずに呼ぶ（＝非ブロッキング）か、フォームを開いたまま
  // awaitするか（clearResolutionのように速い操作向け）を選べる。
  async function sendJournalPatch(
    entryId: string,
    body: Record<string, unknown>,
    retry: () => void,
  ): Promise<JournalEntry | undefined> {
    setPendingEntryIds((prev) => new Set(prev).add(entryId));
    dismissPendingError(entryId);
    try {
      const { res, data } = await fetchWithNameConfirm(
        `/api/journal/${entryId}`,
        { method: "PATCH", body },
        "保存する",
      );
      if (!res.ok) throw new Error((data as { error?: string } | null)?.error ?? "更新に失敗しました");
      // 修正はsupersedesで新しいイベント（＝新しいid）として記録されるため、
      // 古いエントリを新しい内容へ置き換える（一覧の並び順は変えない）。関数形式の
      // 更新を使い、待っている間にポーリングで変わった最新の配列を起点にする。
      setJournalEntries((prev) => prev.map((e) => (e.id === entryId ? (data as { entry: JournalEntry }).entry : e)));
      return (data as { entry: JournalEntry }).entry;
    } catch (err) {
      if ((err as Error).message !== "人名候補の確認をキャンセルしました") {
        setPendingEntryErrors((prev) => ({ ...prev, [entryId]: { message: (err as Error).message, retry } }));
      }
      return undefined;
    } finally {
      setPendingEntryIds((prev) => {
        const next = new Set(prev);
        next.delete(entryId);
        return next;
      });
    }
  }

  // tags/people/urgency/日付（必要なら本文）の確定。本文を触っていなければ
  // maskForStorageは走らないため通常は一瞬で終わるが、本文を編集した場合は
  // 他の更新と同じく時間がかかりうるので、待たずに編集フォームを閉じる。
  function confirmEdit(entryId: string) {
    const body = currentEditPatch();
    setEditingEntryId(null);
    const retry = () => {
      void sendJournalPatch(entryId, body, retry);
    };
    void sendJournalPatch(entryId, body, retry);
  }

  // docs/usage_issues U16。編集フォームを開かず、現在の抽出内容のまま確定する。
  // 自動分析ONかつフィルタ適合なら、サーバ側で初回確定時に分析が起動する。
  function confirmAsIs(entry: JournalEntry) {
    const body = {
      tags: entry.tags,
      people: entry.people,
      urgency: entry.urgency,
      occurredAtDate: timestampToDateInputValue(entry.createdAt),
    };
    const retry = () => {
      void sendJournalPatch(entry.id, body, retry);
    };
    void sendJournalPatch(entry.id, body, retry);
  }

  // docs/usage_issues U16。確定済みJournalをフィルタ／自動設定に関係なく明示分析する。
  // 成功時は相談タブへ遷移できるよう runId を返す。
  async function startAnalysis(entry: JournalEntry): Promise<string | undefined> {
    setPendingEntryIds((prev) => new Set(prev).add(entry.id));
    dismissPendingError(entry.id);
    try {
      const { res, data } = await fetchWithNameConfirm(
        `/api/journal/${entry.id}/analyze`,
        { method: "POST", body: {} },
        "分析を開始する",
      );
      if (!res.ok) throw new Error((data as { error?: string } | null)?.error ?? "分析の起動に失敗しました");
      const payload = data as { entry: JournalEntry; run: { id: string } };
      setJournalEntries((prev) =>
        prev.map((e) => (e.id === entry.id ? { ...payload.entry, sourceConsultRunId: payload.run.id } : e)),
      );
      return payload.run.id;
    } catch (err) {
      if ((err as Error).message !== "人名候補の確認をキャンセルしました") {
        const retry = () => {
          void startAnalysis(entry);
        };
        setPendingEntryErrors((prev) => ({ ...prev, [entry.id]: { message: (err as Error).message, retry } }));
      }
      return undefined;
    } finally {
      setPendingEntryIds((prev) => {
        const next = new Set(prev);
        next.delete(entry.id);
        return next;
      });
    }
  }

  // 「メモを残して解決にする」: Issue化するほどではないが、この件はもう追いかけなくてよい、
  // という判断をJournal自体に記録する。urgencyは書き換えない（起きた出来事の深刻さの記録は
  // そのまま残す）。resolutionNoteはmaskForStorageを通るため時間がかかりうる。
  function resolveWithNote(entryId: string) {
    const note = resolutionNoteDraft.trim();
    if (!note) {
      setEditError("解決メモを入力してください");
      return;
    }
    const body = { ...currentEditPatch(), resolutionNote: note };
    setEditingEntryId(null);
    const retry = () => {
      void sendJournalPatch(entryId, body, retry);
    };
    void sendJournalPatch(entryId, body, retry);
  }

  // 「Issueを起票してこの件を追跡する」: 新規Issueを作成し、そのIssueへ紐付ける。
  // 既存のPOST /api/issuesを1回叩くだけで、新しい起票経路は増やさない。Issue作成後
  // すぐそのIssueへ遷移する既存の挙動を保つため（できたばかりの空のIssueに移動する
  // という一連の操作として）、こちらは他の解決アクションと違いawaitしたまま完了を待つ。
  async function resolveWithNewIssue(entry: JournalEntry): Promise<string | undefined> {
    setEditSubmitting(true);
    setEditError(null);
    try {
      const { res: issueRes, data: issueData } = await fetchWithNameConfirm(
        "/api/issues",
        {
          method: "POST",
          body: {
            title: truncateForTitle(entry.summary || entry.rawText),
            why: entry.rawText,
            tags: editTags.split(",").map((t) => t.trim()).filter(Boolean),
            sourceJournalId: entry.id,
          },
        },
        "保存する",
      );
      if (!issueRes.ok) {
        throw new Error((issueData as { error?: string } | null)?.error ?? "Issueの起票に失敗しました");
      }

      // 意図的にsendJournalPatchは使わない。Issueは既に作成済みのため、この後の
      // 紐付け保存が失敗した場合の「再試行」はIssue作成をやり直さず紐付けだけ
      // やり直す必要があり、sendJournalPatch共通のretry（新規Issueをまた作ってしまう）
      // とは意味が異なる。ここは既存どおりeditError/editSubmittingで扱い、
      // フォームを開いたまま結果を待つ。
      const { res, data } = await fetchWithNameConfirm(
        `/api/journal/${entry.id}`,
        {
          method: "PATCH",
          body: { ...currentEditPatch(), resolvedIssueId: (issueData as { issue: { id: string } }).issue.id },
        },
        "保存する",
      );
      if (!res.ok) {
        throw new Error(
          (data as { error?: string } | null)?.error ?? "Issueへの紐付けに失敗しました（Issue自体は作成されています）",
        );
      }
      setJournalEntries((prev) => prev.map((e) => (e.id === entry.id ? (data as { entry: JournalEntry }).entry : e)));
      setEditingEntryId(null);
      return (issueData as { issue: { id: string } }).issue.id;
    } catch (err) {
      if ((err as Error).message !== "人名候補の確認をキャンセルしました") {
        setEditError((err as Error).message);
      }
      return undefined;
    } finally {
      setEditSubmitting(false);
    }
  }

  // 解決状態の取り消し（誤ってIssue化/メモした場合の巻き戻し）。編集フォームを
  // 閉じない操作であり、resolutionNote/rawTextを含まないため通常は速い。意図的に
  // sendJournalPatchは使わず、フォームを開いたままeditErrorでエラーを出す
  // （resolveWithNewIssueと同じ理由——編集中の他の入力を巻き込んでエラーカードに
  // 差し替えたくない）。
  async function clearResolution(entryId: string) {
    setEditSubmitting(true);
    setEditError(null);
    try {
      const { res, data } = await fetchWithNameConfirm(
        `/api/journal/${entryId}`,
        {
          method: "PATCH",
          body: { ...currentEditPatch(), resolvedIssueId: null, resolutionNote: null },
        },
        "保存する",
      );
      if (!res.ok) throw new Error((data as { error?: string } | null)?.error ?? "更新に失敗しました");
      setJournalEntries((prev) => prev.map((e) => (e.id === entryId ? (data as { entry: JournalEntry }).entry : e)));
    } catch (err) {
      if ((err as Error).message !== "人名候補の確認をキャンセルしました") {
        setEditError((err as Error).message);
      }
    } finally {
      setEditSubmitting(false);
    }
  }

  return {
    editingEntryId,
    editRawText,
    setEditRawText: (value: string) => {
      setEditRawText(value);
      setRawTextTouched(true);
    },
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
    confirmAsIs,
    startAnalysis,
    resolutionNoteDraft,
    setResolutionNoteDraft,
    resolveWithNote,
    resolveWithNewIssue,
    clearResolution,
    isEntryPending,
    pendingEntryErrors,
    dismissPendingError,
    nameCandidateDialog,
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

export function usePersonProfile(id: string, intervalMs = 5000) {
  const { data, loaded, refresh } = usePolling<{ person: PersonProfile | null }>(`/api/people/${id}`, { person: null }, intervalMs);
  return { person: data.person, personLoaded: loaded, refreshPerson: refresh };
}

// docs/memo.md「L. 介入の閉ループ」対応。アーカイブ済み・チーム紐付き済みのIssue
// でのみ意味を持つため、呼び出し側がenabledで制御する（無駄なポーリングを避ける）。
export function useIssueImpact(id: string, enabled: boolean, intervalMs = 10000) {
  const { data, loaded, refresh } = usePolling<{ impact: IssueImpact | null }>(`/api/issues/${id}/impact`, { impact: null }, intervalMs, enabled);
  return { impact: data.impact, impactLoaded: loaded, refreshImpact: refresh };
}

export function useIssue(id: string, intervalMs = 2000) {
  const { data, setData, loaded, refresh } = usePolling<{ issue: Issue | null; sourceJournals?: JournalEntry[] }>(
    `/api/issues/${id}`,
    { issue: null, sourceJournals: [] },
    intervalMs,
  );
  return {
    issue: data.issue,
    sourceJournals: data.sourceJournals ?? [],
    setIssue: (issue: Issue | null) => setData((prev) => ({ ...prev, issue })),
    issueLoaded: loaded,
    refreshIssue: refresh,
  };
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
