"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import styles from "@/app/page.module.css";
import { CopilotChat, ExecutionState, listIssueCandidatesFromProposal, runFallbackTitle, type AgentRun } from "@/components/RunDetail";
import { ConsultHistoryItem } from "@/components/ConsultHistoryItem";
import { OriginTrace } from "@/components/OriginTrace";
import { IdLinkedText } from "@/components/IdLinkedText";
import { useIssues, useJournalEntry, useRuns, useSettingsRules } from "@/lib/hooks";
import { useNameCandidateConfirm } from "@/lib/useNameCandidateConfirm";
import { isRunStale, truncateForTitle } from "@/lib/types";
import { journalExcerptFromTask } from "@/lib/origin-trace";

const ORIGIN_LABEL: Record<AgentRun["origin"], string> = {
  manual: "",
  "auto-anomaly": "Journal自動分析",
  "auto-summary": "朝のサマリー",
  "auto-issue-update": "Issue更新分析",
  "auto-distill": "状況蒸留",
};

const TRIAGE_LABEL: Record<"watching" | "dismissed", string> = {
  watching: "👀 様子見",
  dismissed: "却下",
};

// docs/memo.md TODO「これまでに収集された事実等をベースにIssue等と関係なく横断的な相談、
// 質問ができるチャットを用意する」への対応。特定のIssueに紐付けないLead Agentのrunを
// この画面専用の「相談」として扱う（Issue化されていないLead Agent runがそれに相当する）。
// 新規のデータモデル・APIは増やさず、既存のAgent Runtime（startRun/decideRun）と
// 既存のExecutionState/CopilotChat UIをそのまま流用する。

export default function ChatPage() {
  return (
    <Suspense fallback={null}>
      <ChatPageInner />
    </Suspense>
  );
}

function ChatPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { runs, runsLoaded, refreshRuns } = useRuns();
  const { issues, issuesLoaded, refreshIssues } = useIssues();
  const { rules } = useSettingsRules();
  const { fetchWithNameConfirm, nameCandidateDialog } = useNameCandidateConfirm();
  const staleRunIds = new Set(
    runs.filter((r) => isRunStale(r.status, r.updatedAt, rules.agentStaleAfterSeconds)).map((r) => r.id),
  );

  // Issueに紐付いていないLead Agent runだけを「相談履歴」として扱う。
  const chatRuns = runs
    .filter((r) => r.agentName === "Lead Agent" && !issues.some((i) => i.agentRunId === r.id))
    .sort((a, b) => b.updatedAt - a.updatedAt);
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
    const params = new URLSearchParams(searchParams.toString());
    mutate(params);
    const qs = params.toString();
    router.replace(qs ? `/chat?${qs}` : "/chat", { scroll: false });
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
    setStartError(null);
    replaceChatQuery((params) => {
      params.delete("runId");
    });
  }

  // URLで指定されたLead runが一覧フィルタ外でも履歴に出す（Issue化済みや取得遅延の保険）。
  const historyRuns = (() => {
    if (!pinnedRun || pinnedRun.agentName !== "Lead Agent") return chatRuns;
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
    document.getElementById(`chat-history-${selectedId}`)?.scrollIntoView({ block: "nearest" });
  }, [selectedId, chatHistoryLoaded, historyRuns.length]);

  // docs/memo.md「C. Journalセンシング→行動」対応。Quick Journalの@人物クリックや
  // 「要注目Journal」カードから、相談内容を書いた状態でこの画面を開けるようにする。
  const [task, setTask] = useState(searchParams.get("prefill") ?? "");
  const [requireExecConsult, setRequireExecConsult] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [deciding, setDeciding] = useState(false);
  const [decideError, setDecideError] = useState<string | null>(null);

  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  // 複数候補時のチェック状態。run切り替えで null に戻し、そのときは全選択扱い。
  const [candidatePick, setCandidatePick] = useState<{ runId: string; selected: boolean[] } | null>(null);
  const queryJournalId = searchParams.get("journalId");
  const { entry: sourceJournal } = useJournalEntry(selectedRun?.sourceJournalId);

  const issueCandidates = listIssueCandidatesFromProposal(selectedRun?.proposal);
  const candidateSelectedFlags =
    selectedRun && candidatePick?.runId === selectedRun.id && candidatePick.selected.length === issueCandidates.length
      ? candidatePick.selected
      : issueCandidates.map(() => true);
  const selectedCandidateTitles = issueCandidates
    .filter((_, i) => candidateSelectedFlags[i])
    .map((c) => c.title);

  function toggleCandidate(index: number) {
    if (!selectedRun) return;
    const next = [...candidateSelectedFlags];
    next[index] = !next[index];
    setCandidatePick({ runId: selectedRun.id, selected: next });
  }

  async function handlePromoteToIssue() {
    if (!selectedRun) return;
    const titles =
      issueCandidates.length > 1
        ? selectedCandidateTitles
        : issueCandidates.length === 1
          ? [issueCandidates[0].title]
          : [runFallbackTitle(selectedRun)];
    if (titles.length === 0) {
      setReviewError("起票する候補を1件以上選んでください");
      return;
    }
    setReviewSubmitting(true);
    setReviewError(null);
    try {
      const createdIds: string[] = [];
      for (let i = 0; i < titles.length; i++) {
        const title = truncateForTitle(titles[i]);
        // 先頭だけ agentRunId を付けて Run レビュー／Journal 単数紐付け。以降は sourceRunId のみ（親なし独立Issue）。
        const body =
          i === 0
            ? { title, agentRunId: selectedRun.id }
            : {
                title,
                sourceRunId: selectedRun.id,
                ...(selectedRun.sourceJournalId ? { sourceJournalId: selectedRun.sourceJournalId } : {}),
              };
        const { res, data } = await fetchWithNameConfirm("/api/issues", { method: "POST", body }, "保存する");
        if (!res.ok) throw new Error((data as { error?: string } | null)?.error ?? "Issue化に失敗しました");
        createdIds.push((data as { issue: { id: string } }).issue.id);
      }
      await refreshIssues();
      setCandidatePick(null);
      if (createdIds.length === 1) {
        router.push(`/issues/${createdIds[0]}`);
      } else {
        router.push("/issues");
      }
    } catch (err) {
      if ((err as Error).message !== "人名候補の確認をキャンセルしました") {
        setReviewError((err as Error).message);
      }
    } finally {
      setReviewSubmitting(false);
    }
  }

  async function handleTriage(status: "watching" | "dismissed") {
    if (!selectedRun) return;
    setReviewSubmitting(true);
    setReviewError(null);
    try {
      const res = await fetch(`/api/agents/${selectedRun.id}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ triageStatus: status }),
      });
      if (!res.ok) throw new Error("記録に失敗しました");
      await refreshRuns();
    } catch (err) {
      setReviewError((err as Error).message);
    } finally {
      setReviewSubmitting(false);
    }
  }

  async function handleStartNew(e: React.FormEvent) {
    e.preventDefault();
    if (!task.trim()) return;
    setStarting(true);
    setStartError(null);
    try {
      const { res, data } = await fetchWithNameConfirm(
        "/api/agents",
        {
          method: "POST",
          body: {
            agentName: "Lead Agent",
            task,
            sourceJournalId: queryJournalId || undefined,
            requireExecConsult: requireExecConsult || undefined,
          },
        },
        "送信する",
      );
      if (!res.ok) throw new Error((data as { error?: string } | null)?.error ?? "開始に失敗しました");
      setTask("");
      setRequireExecConsult(false);
      selectHistoryRun((data as { run: { id: string } }).run.id);
      await refreshRuns();
    } catch (err) {
      if ((err as Error).message !== "人名候補の確認をキャンセルしました") {
        setStartError((err as Error).message);
      }
    } finally {
      setStarting(false);
    }
  }

  async function sendDecision(text: string) {
    if (!selectedRun || !text.trim()) return;
    setDeciding(true);
    setDecideError(null);
    try {
      const { res, data } = await fetchWithNameConfirm(
        `/api/agents/${selectedRun.id}/decide`,
        { method: "POST", body: { message: text } },
        "送信する",
      );
      if (!res.ok) throw new Error((data as { error?: string } | null)?.error ?? "送信に失敗しました");
      setMessage("");
      setSelectedOptionId(null);
      await refreshRuns();
    } catch (err) {
      if ((err as Error).message !== "人名候補の確認をキャンセルしました") {
        setDecideError((err as Error).message);
      }
    } finally {
      setDeciding(false);
    }
  }

  function handleConfirmOption() {
    if (!selectedRun || !selectedOptionId) return;
    const opt = selectedRun.yieldRequest?.options.find((o) => o.id === selectedOptionId);
    if (!opt) return;
    sendDecision(`Option ${opt.id}（${opt.label}）を採用します。この方針で進めてください。`);
  }

  function handleFocusChat() {
    document.getElementById("chat-page-input")?.focus();
  }

  const [themesSubmitting, setThemesSubmitting] = useState(false);

  async function handleAdoptThemes() {
    if (!selectedRun) return;
    setThemesSubmitting(true);
    setDecideError(null);
    try {
      const res = await fetch(`/api/agents/${selectedRun.id}/themes`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "テーマの採用に失敗しました");
      await refreshRuns();
    } catch (err) {
      setDecideError((err as Error).message);
    } finally {
      setThemesSubmitting(false);
    }
  }

  async function handleDismissThemes() {
    if (!selectedRun) return;
    setThemesSubmitting(true);
    setDecideError(null);
    try {
      const res = await fetch(`/api/agents/${selectedRun.id}/themes`, { method: "DELETE" });
      if (!res.ok) throw new Error("テーマ提案の却下に失敗しました");
      await refreshRuns();
    } catch (err) {
      setDecideError((err as Error).message);
    } finally {
      setThemesSubmitting(false);
    }
  }

  return (
    <div className={`${styles.layout} ${styles.screen}`}>
      <div className={styles.panel}>
        <h2>相談履歴</h2>
        <p className={styles.subtitle}>Issueに起票していない、Lead Agentとの横断的な相談だけがここに並びます。</p>
        <button className={styles.primaryBtn} onClick={clearHistorySelection}>
          ＋ 新しい相談を始める
        </button>
        <div className={styles.runList}>
          {historyRuns.length === 0 && (
            <p className={styles.subtitle}>{!chatHistoryLoaded ? "読み込み中…" : "まだ相談履歴はありません。"}</p>
          )}
          {pinError && (
            <p className={styles.errorText} role="alert">
              {pinError}
            </p>
          )}
          {historyRuns.map((r) => (
            <ConsultHistoryItem
              key={r.id}
              run={r}
              selected={selectedId === r.id}
              stale={staleRunIds.has(r.id)}
              onSelect={() => selectHistoryRun(r.id)}
            />
          ))}
        </div>
      </div>

      <div className={styles.panel}>
        {selectedRun ? (
          <>
            <h2>Lead Agentへの相談</h2>
            <OriginTrace
              journals={
                sourceJournal
                  ? [sourceJournal]
                  : selectedRun.sourceJournalId
                    ? [
                        {
                          id: selectedRun.sourceJournalId,
                          rawText: journalExcerptFromTask(selectedRun.task) ?? "",
                        },
                      ]
                    : journalExcerptFromTask(selectedRun.task)
                      ? [
                          {
                            id: "",
                            rawText: journalExcerptFromTask(selectedRun.task) ?? "",
                          },
                        ]
                      : []
              }
            />
            <div className={styles.yieldBlock} style={{ marginBottom: 12 }}>
              {selectedRun.origin !== "manual" && !selectedRun.reviewed && (
                <>
                  <strong>📋 ドラフトIssue（起票待ち）— {ORIGIN_LABEL[selectedRun.origin]}</strong>
                  <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: 6 }}>
                    AIの自動分析の出口です。追跡するなら「Issueにする」、様子を見るなら「様子見」、不要なら却下してください。EMが選ぶまでここに残り続けます。
                  </p>
                </>
              )}
              {selectedRun.triageStatus && (
                <p style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                  現在のステータス: {TRIAGE_LABEL[selectedRun.triageStatus]}（ボタンでいつでも変更できます）
                </p>
              )}
              <div className={styles.yieldActions}>
                {issueCandidates.length > 1 && (
                  <div style={{ width: "100%", marginBottom: 8 }}>
                    <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: "0 0 6px" }}>
                      AIが親なしの独立Issue候補を複数出しています。起票する件にチェックを入れてください（Journal紐付けは先頭の1件のみ）。
                    </p>
                    <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                      {issueCandidates.map((c, i) => (
                        <li key={`${c.title}-${i}`} style={{ marginBottom: 4 }}>
                          <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: "0.8125rem", cursor: "pointer" }}>
                            <input
                              type="checkbox"
                              checked={candidateSelectedFlags[i] ?? false}
                              onChange={() => toggleCandidate(i)}
                              disabled={reviewSubmitting}
                              style={{ marginTop: 3 }}
                            />
                            <span>
                              <IdLinkedText text={c.title} />
                              {c.rationale ? (
                                <span style={{ color: "var(--text-muted)", display: "block", fontSize: "0.75rem" }}>
                                  <IdLinkedText text={c.rationale} />
                                </span>
                              ) : null}
                            </span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <button
                  className={styles.primaryBtn}
                  style={{ width: "auto" }}
                  disabled={reviewSubmitting || (issueCandidates.length > 1 && selectedCandidateTitles.length === 0)}
                  onClick={handlePromoteToIssue}
                >
                  {issueCandidates.length > 1
                    ? `📌 選択した${selectedCandidateTitles.length}件をIssueにする`
                    : "📌 Issueにする"}
                </button>
                <button className={styles.btnOutline} disabled={reviewSubmitting} onClick={() => handleTriage("watching")}>
                  👀 様子見
                </button>
                <button className={styles.btnOutline} disabled={reviewSubmitting} onClick={() => handleTriage("dismissed")}>
                  却下する（対応不要）
                </button>
              </div>
              {reviewError && <p className={styles.errorText} role="alert">{reviewError}</p>}
            </div>
            <ExecutionState
              run={selectedRun}
              selectedOptionId={selectedOptionId}
              onSelectOption={setSelectedOptionId}
              onConfirmOption={handleConfirmOption}
              onFocusChat={handleFocusChat}
              deciding={deciding}
              stale={staleRunIds.has(selectedRun.id)}
              onRetry={() => sendDecision("直前の処理がエラーで中断しました。同じ内容を踏まえて再度実行してください。")}
              onAdoptThemes={handleAdoptThemes}
              onDismissThemes={handleDismissThemes}
              themesSubmitting={themesSubmitting}
            />
            <hr style={{ margin: "14px 0", border: "none", borderTop: "1px solid var(--border)" }} />
            <CopilotChat run={selectedRun} message={message} setMessage={setMessage} deciding={deciding} onDecide={sendDecision} inputId="chat-page-input" />
            {decideError && <p className={styles.errorText} role="alert">{decideError}</p>}
          </>
        ) : (
          <>
            <h2>何でも相談</h2>
            <p className={styles.subtitle}>
              まだIssueにしないモヤモヤ・仮説検証はここ。特定のIssueに紐付けず、これまで収集されたJournal・組織情報を踏まえてLead Agentに相談できます。追跡・計画が必要になったら会話画面の「Issueにする」で昇格できます。実行中の介入の壁打ちはIssue Workspaceで行ってください。
            </p>
            <form onSubmit={handleStartNew}>
              <div className={styles.field}>
                <label>相談したいこと
                <textarea
                  value={task}
                  onChange={(e) => setTask(e.target.value)}
                  rows={3}
                  placeholder="例: 最近チーム全体の元気度が心配。何を確認すればいい？"
                /></label>
              </div>
              <label
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "flex-start",
                  fontSize: "0.8125rem",
                  marginBottom: 12,
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={requireExecConsult}
                  onChange={(e) => setRequireExecConsult(e.target.checked)}
                  disabled={starting}
                  style={{ marginTop: 3 }}
                />
                <span>
                  経営／役員目線の厳しいレビューも聞く
                  <span style={{ display: "block", color: "var(--text-muted)", fontSize: "0.75rem", marginTop: 2 }}>
                    Leadが組織MVV・中長期コミットの視点でExec Agentへ必須相談します（普段はOFFで十分です）
                  </span>
                </span>
              </label>
              <button className={styles.primaryBtn} type="submit" disabled={starting || !task.trim()}>
                {starting ? "開始中…" : "相談を始める"}
              </button>
            </form>
            {startError && <p className={styles.errorText} role="alert">{startError}</p>}
          </>
        )}
      </div>
      {nameCandidateDialog}
    </div>
  );
}
