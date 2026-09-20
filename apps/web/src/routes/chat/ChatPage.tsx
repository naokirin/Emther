import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import styles from "../../styles/page.module.css";
import { listIssueCandidatesFromProposal, type AgentRun } from "../../components/RunDetail";
import { ChatHistoryPanel } from "../../components/chat/ChatHistoryPanel";
import { ConsultReviewPanel } from "../../components/chat/ConsultReviewPanel";
import { NewConsultForm } from "../../components/chat/NewConsultForm";
import { useIssues, useJournalEntry, useRuns, useSettingsRules } from "../../lib/queries";
import { useNameCandidateConfirm } from "../../lib/useNameCandidateConfirm";
import { isConsultHistoryRun } from "@emther/core/origin-trace";
import { isRunStale } from "@emther/core/types";

// docs/memo.md TODO「これまでに収集された事実等をベースにIssue等と関係なく横断的な相談、
// 質問ができるチャットを用意する」への対応。Lead Agent の相談スレッドをこの画面で扱う。
// 提案化後も履歴に残し、分割起票や提案に紐づかない続きの壁打ちができるようにする
// （提案詳細専用の起票分析／更新分析だけ除外。isConsultHistoryRun）。
// react-routerのuseSearchParamsはSuspenseを要求しないため、元実装の<Suspense>ラッパーは不要
// （削除した）。

export function ChatPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { runs, runsLoaded, refreshRuns } = useRuns();
  const { issues, issuesLoaded, refreshIssues } = useIssues();
  const { rules } = useSettingsRules();
  const { fetchWithNameConfirm, nameCandidateDialog } = useNameCandidateConfirm();
  const staleRunIds = new Set(
    runs.filter((r) => isRunStale(r.status, r.updatedAt, rules.agentStaleAfterSeconds)).map((r) => r.id),
  );

  // docs/memo.md「相談、Journal、提案を削除（アーカイブ）したい」対応。既定ではアーカイブ済み
  // （誤って起票した・テストで作った等）を履歴一覧から除外し、必要なときだけ表示できるようにする。
  const [showArchivedConsults, setShowArchivedConsults] = useState(false);

  // 提案化済みでも相談履歴に残す（提案詳細専用の分析 Run だけ除外）。
  const consultRuns = runs.filter(isConsultHistoryRun);
  const archivedConsultCount = consultRuns.filter((r) => r.archivedAt).length;
  const chatRuns = consultRuns
    .filter((r) => showArchivedConsults || !r.archivedAt)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const promotedRunIds = new Set(
    issues.flatMap((i) => [i.agentRunId, i.sourceRunId].filter((id): id is string => Boolean(id))),
  );
  const chatHistoryLoaded = runsLoaded && issuesLoaded;

  // docs/usage_issues U6。runs+issuesの両方が揃ってから runId を選択する。
  // 蒸留など巨大taskの旧runは /api/agents 全件に載らない／遅延することがあるため、
  // 一覧に無いときは GET /api/agents/[id] で1件だけ拾って履歴へピン留めする。
  // 選択の同期は queryRunId 変化時のみ（runs ポーリング依存にすると、履歴クリック直後に
  // URL の runId＝先頭付近の相談へ選択が引き戻される）。
  const queryRunId = searchParams.get("runId");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectionSyncKey, setSelectionSyncKey] = useState(`${queryRunId ?? ""}:${chatHistoryLoaded}`);
  const nextSelectionSyncKey = `${queryRunId ?? ""}:${chatHistoryLoaded}`;
  // URL / ロード完了に合わせて選択を揃える（effect 内 setState は lint 禁止のため render 時に調整）。
  if (selectionSyncKey !== nextSelectionSyncKey) {
    setSelectionSyncKey(nextSelectionSyncKey);
    if (queryRunId && chatHistoryLoaded) {
      setSelectedId(queryRunId);
    }
  }

  const listedPin = queryRunId ? (runs.find((r) => r.id === queryRunId) ?? null) : null;
  const [remotePin, setRemotePin] = useState<{
    queryRunId: string;
    run: AgentRun | null;
    error: string | null;
  } | null>(null);

  const pinnedRun: AgentRun | null =
    !queryRunId || !chatHistoryLoaded
      ? null
      : (listedPin ?? (remotePin?.queryRunId === queryRunId ? remotePin.run : null));
  const pinError: string | null =
    !queryRunId || !chatHistoryLoaded || listedPin
      ? null
      : remotePin?.queryRunId === queryRunId
        ? remotePin.error
        : null;

  useEffect(() => {
    if (!queryRunId || !chatHistoryLoaded) return;
    if (runs.some((r) => r.id === queryRunId)) return;

    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/agents/${queryRunId}`);
        const data = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok || !data?.run) {
          setRemotePin({
            queryRunId,
            run: null,
            error: "指定された相談が見つかりませんでした。",
          });
          return;
        }
        setRemotePin({ queryRunId, run: data.run as AgentRun, error: null });
      } catch {
        if (!cancelled) {
          setRemotePin({
            queryRunId,
            run: null,
            error: "相談の取得に失敗しました。",
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [queryRunId, chatHistoryLoaded, runs]);

  function replaceChatQuery(mutate: (params: URLSearchParams) => void) {
    const params = new URLSearchParams(searchParams);
    mutate(params);
    setSearchParams(params, { replace: true });
  }

  function selectHistoryRun(id: string) {
    setSelectedId(id);
    setCandidatePick(null);
    replaceChatQuery((params) => {
      params.set("runId", id);
    });
  }

  function clearHistorySelection() {
    setSelectedId(null);
    replaceChatQuery((params) => {
      params.delete("runId");
    });
  }

  // URLで指定されたLead runが一覧に無いときも履歴へピン留め（取得遅延の保険）。
  const historyRuns = (() => {
    if (!pinnedRun || !isConsultHistoryRun(pinnedRun)) return chatRuns;
    if (chatRuns.some((r) => r.id === pinnedRun.id)) {
      return chatRuns.map((r) => (r.id === pinnedRun.id ? pinnedRun : r));
    }
    return [pinnedRun, ...chatRuns];
  })();

  const selectedRun: AgentRun | null = selectedId
    ? (historyRuns.find((r) => r.id === selectedId) ??
      (pinnedRun?.id === selectedId ? pinnedRun : null) ??
      runs.find((r) => r.id === selectedId && r.agentName === "Lead Agent") ??
      null)
    : null;

  useEffect(() => {
    if (!selectedId) return;
    document.getElementById(`chat-history-${selectedId}`)?.scrollIntoView?.({ block: "nearest" });
  }, [selectedId, chatHistoryLoaded, historyRuns.length]);

  // 複数候補時のチェック状態。run切り替えで null に戻し、そのときは全選択扱い。
  // selectHistoryRunが明示的にリセットする既存の挙動を保つため、ConsultReviewPanel側に
  // 移さずここに残している。
  const [candidatePick, setCandidatePick] = useState<{ runId: string; selected: boolean[] } | null>(null);
  const queryJournalId = searchParams.get("journalId");
  const { entry: sourceJournal } = useJournalEntry(selectedRun?.sourceJournalId);

  const issueCandidates = listIssueCandidatesFromProposal(selectedRun?.proposal);

  async function handleConsultStarted(runId: string) {
    selectHistoryRun(runId);
    await refreshRuns();
  }

  return (
    <div className={`${styles.layout} ${styles.screen}`}>
      <ChatHistoryPanel
        historyRuns={historyRuns}
        selectedId={selectedId}
        staleRunIds={staleRunIds}
        promotedRunIds={promotedRunIds}
        chatHistoryLoaded={chatHistoryLoaded}
        pinError={pinError}
        showArchivedConsults={showArchivedConsults}
        onChangeShowArchivedConsults={setShowArchivedConsults}
        archivedConsultCount={archivedConsultCount}
        onSelect={selectHistoryRun}
        onNewConsult={clearHistorySelection}
      />

      <div className={styles.panel}>
        {selectedRun ? (
          <ConsultReviewPanel
            selectedRun={selectedRun}
            sourceJournal={sourceJournal}
            issueCandidates={issueCandidates}
            candidatePick={candidatePick}
            setCandidatePick={setCandidatePick}
            stale={staleRunIds.has(selectedRun.id)}
            fetchWithNameConfirm={fetchWithNameConfirm}
            refreshRuns={refreshRuns}
            refreshIssues={refreshIssues}
            issues={issues}
            onReanalyzed={handleConsultStarted}
          />
        ) : (
          <NewConsultForm
            initialTask={searchParams.get("prefill") ?? ""}
            queryJournalId={queryJournalId}
            fetchWithNameConfirm={fetchWithNameConfirm}
            onStarted={handleConsultStarted}
          />
        )}
      </div>
      {nameCandidateDialog}
    </div>
  );
}
