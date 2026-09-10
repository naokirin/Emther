"use client";

import { useEffect, useRef } from "react";
import styles from "@/app/page.module.css";
import { YIELD_KIND_META, ISSUE_PRIORITY_META, type IssuePriority, type YieldKind } from "@/lib/types";

// "queued"はサーバー側の同時実行数の上限（SettingsのmaxParallelAgentRuns）に達しており、
// CLI子プロセスの起動を待っている状態（@/lib/agent-runtime.tsのAgentStatus参照）。
export type AgentStatus = "active" | "queued" | "yield" | "idle" | "error";

export type YieldOption = {
  id: string;
  label: string;
  detail?: string;
  risk?: string;
};

export type LogLine = {
  ts: number;
  channel: "meta" | "agent" | "system";
  text: string;
};

export type RejectedAlternative = {
  option: string;
  reason: string;
};

export type Proposal = {
  conclusion: string;
  facts: string[];
  logic: string;
  rejectedAlternatives: RejectedAlternative[];
  recommendation?: "issue" | "dismiss" | "watch";
};

export type SuggestedSubIssue = {
  title: string;
  priority?: IssuePriority;
};

export type AgentRun = {
  id: string;
  agentName: string;
  task: string;
  status: AgentStatus;
  sessionId?: string;
  log: LogLine[];
  yieldRequest?: { reason: string; options: YieldOption[]; kind?: YieldKind };
  proposal?: Proposal;
  suggestedActionItems?: string[];
  suggestedSubIssues?: SuggestedSubIssue[];
  suggestedCharter?: { why?: string; what?: string; how?: string };
  suggestedPriority?: IssuePriority;
  totalCostUsd: number;
  createdAt: number;
  updatedAt: number;
  consultedBy?: string;
  origin: "manual" | "auto-anomaly" | "auto-summary" | "auto-issue-update";
  sourceJournalId?: string;
  reviewed: boolean;
  triageStatus?: "watching" | "dismissed";
  triageAt?: number;
};

// ユーザー指摘対応: run.taskが空文字のrun（何らかの理由でtask保存に失敗した壊れたデータ）を
// そのままIssueタイトルにすると、サーバー側の「titleは必須です」検証で400になり、EMが
// クリックしても何も起きない（エラーがUIに出ない）まま詰む。run.task以外にも意味のある
// テキスト（Yieldの理由・最初のログ行）があればそれを使い、それも無ければ最低限
// エージェント名だけのタイトルにフォールバックし、Issue化自体は必ず成功させる。
//
// ユーザー指摘対応（続報）: auto-anomaly/auto-summaryのrunはrun.task自体が「〜を判断
// してください」という定型の指示文＋本文という長い文字列で、EMが書いた短い文ではない。
// これをそのままタイトルにすると（呼び出し側でtruncateForTitleしても）本文へ辿り着く
// 前の定型句だけが残ってしまう。proposal.conclusionはAIが実際に出した結論そのもの
// （journal-store.tsのプロンプトで必ず「結論の中でIssue化を検討する旨を明記」させている）
// なので、存在すればtaskより優先してタイトルに使う。
export function runFallbackTitle(run: AgentRun): string {
  const conclusion = run.proposal?.conclusion.trim();
  if (conclusion) return conclusion;
  const task = run.task.trim();
  if (task) return task;
  const yieldReason = run.yieldRequest?.reason.trim();
  if (yieldReason) return yieldReason;
  const firstLogLine = run.log.find((l) => l.channel !== "system")?.text.trim();
  if (firstLogLine) return firstLogLine;
  return `${run.agentName}のRun（内容未記録）`;
}

export const STATUS_META: Record<AgentStatus, { icon: string; label: string; cls: string }> = {
  active: { icon: "🟢", label: "Active", cls: styles.active },
  queued: { icon: "⏳", label: "Queued（順番待ち）", cls: styles.queued },
  yield: { icon: "🟡", label: "Yield / Waiting", cls: styles.yield },
  idle: { icon: "⚪️", label: "Idle（完了・待機中）", cls: styles.idle },
  error: { icon: "🔴", label: "Error", cls: styles.error },
};

// staleは「statusが"active"のままログ更新が長時間無い」ことをクライアント側で判定した結果
// （@/lib/typesのisRunStale）。実際にkillされたか否かに関わらず、EMには早く気づいてほしいので
// 実データ（status）を書き換えるのではなく、表示だけをTeam Vitalsの「評価不能」と同じ
// 破線スタイルでオーバーライドする。
export function StatusBadge({ status, stale }: { status: AgentStatus; stale?: boolean }) {
  if (stale && status === "active") {
    return <span className={`${styles.badge} ${styles.stale}`}>❔ 応答なし（無応答）</span>;
  }
  const meta = STATUS_META[status];
  return (
    <span className={`${styles.badge} ${meta.cls}`}>
      {meta.icon} {meta.label}
    </span>
  );
}

// docs/em_ui_ux_issue.md 5節「Yield種別カードUI」対応。サーバー側（agent-runtime.ts）は
// 既にkindを正規化して返すが、キャッシュされた古いrunデータ等との保険として同じ
// フォールバック（options有無からdecide/informへ）をクライアント側にも持たせる。
export function resolveYieldKind(kind: YieldKind | undefined, optionsLength: number): YieldKind {
  if (kind) return kind;
  return optionsLength === 0 ? "inform" : "decide";
}

// docs/memo.md「A」対応。Inbox一覧・「次にすべきこと」で語彙を揃えるための共通ラベル関数。
// docs/em_ui_ux_issue.md 5節対応。yield中はDecide/Inform/Commitの種別まで見せる
// （§2.3「Morning ModeのYieldカードはDecide/Inform/Commitのみを載せる」の語彙を揃える）。
// ダッシュボード（判断カード表）と/agents（Inbox一覧）の両方から使う共通ヘルパー。
export function runKindLabel(run: AgentRun): string {
  if (run.status === "yield" && run.yieldRequest) {
    const kind = resolveYieldKind(run.yieldRequest.kind, run.yieldRequest.options.length);
    return YIELD_KIND_META[kind].label;
  }
  if (run.origin === "auto-anomaly") return "Journal自動分析";
  if (run.origin === "auto-summary") return "朝のサマリー";
  if (run.origin === "auto-issue-update") return "Issue更新分析";
  if (run.status === "yield") return "Yield";
  return "手動";
}

/**
 * ダッシュボードの「次の1手」から外す run。
 * 専門Agentへの相談子run、EMが却下したもの、紐づくIssueがアーカイブ済みのもの。
 * 様子見は呼び出し側で別扱い（期限内は非表示、期限切れは再浮上）。
 */
export function shouldOmitRunFromNextActions(
  run: Pick<AgentRun, "id" | "consultedBy" | "triageStatus">,
  issues: { agentRunId?: string; archived: boolean }[],
): boolean {
  if (run.consultedBy) return true;
  if (run.triageStatus === "dismissed") return true;
  return issues.some((i) => i.agentRunId === run.id && i.archived);
}

/** 自動起動かつ未トリアージ（起票／様子見／却下前）のドラフト。Issue行ではなく AgentRun が正。 */
export function isDraftAwaitingTriage(
  run: Pick<AgentRun, "origin" | "reviewed" | "triageStatus">,
): boolean {
  return (
    run.origin !== "manual" &&
    !run.reviewed &&
    run.triageStatus !== "watching" &&
    run.triageStatus !== "dismissed"
  );
}

/**
 * ダッシュボード／相談の「ドラフトIssue」語彙。
 * idle完了＝起票待ち、active/queued＝分析中。yield/error は従来の種別ラベルを優先。
 */
export function draftKindLabel(run: AgentRun): string {
  if (!isDraftAwaitingTriage(run)) return runKindLabel(run);
  if (run.status === "active" || run.status === "queued") return "ドラフト分析中";
  if (run.status === "idle") return "ドラフトIssue";
  return runKindLabel(run);
}

// docs/first_implession/em_ui_wireframe_v5.html の Issue Workspace「Execution State」に対応。
// Context（このrunが何のタスクか）＋ Yieldの選択UI（ラジオ風カード＋共通の確定/壁打ちボタン）＋
// 通常完了時のProposalを表示する。Action Itemsは呼び出し側（Issueがある場合のみ）で追加する。
export function ExecutionState({
  run,
  selectedOptionId,
  onSelectOption,
  onConfirmOption,
  onFocusChat,
  deciding,
  stale,
  onRetry,
  onAdoptActionItems,
  onDismissActionItems,
  actionItemsSubmitting,
  onAdoptSubIssues,
  onDismissSubIssues,
  subIssuesSubmitting,
  onAdoptCharter,
  onDismissCharter,
  charterSubmitting,
  onAdoptPriority,
  onDismissPriority,
  prioritySubmitting,
}: {
  run: AgentRun;
  selectedOptionId: string | null;
  onSelectOption: (id: string) => void;
  onConfirmOption: () => void;
  onFocusChat: () => void;
  deciding: boolean;
  stale?: boolean;
  onRetry?: () => void;
  onAdoptActionItems?: (items: string[]) => void;
  onDismissActionItems?: () => void;
  actionItemsSubmitting?: boolean;
  onAdoptSubIssues?: (items: SuggestedSubIssue[]) => void;
  onDismissSubIssues?: () => void;
  subIssuesSubmitting?: boolean;
  onAdoptCharter?: (charter: { why?: string; what?: string; how?: string }) => void;
  onDismissCharter?: () => void;
  charterSubmitting?: boolean;
  onAdoptPriority?: (priority: IssuePriority) => void;
  onDismissPriority?: () => void;
  prioritySubmitting?: boolean;
}) {
  const CHARTER_FIELD_LABEL: Record<"why" | "what" | "how", string> = {
    why: "Why（生む価値・誰のため・なぜ今か）",
    what: "What（何を・どこまで・どのくらい・完了の定義）",
    how: "How（どのように実現するか・前提や制約）",
  };
  return (
    <>
      <p className={styles.contextText}>
        <strong>Context:</strong> {run.task}
      </p>

      {run.status === "yield" && run.yieldRequest && (() => {
        const kind = resolveYieldKind(run.yieldRequest.kind, run.yieldRequest.options.length);
        const kindMeta = YIELD_KIND_META[kind];
        return (
        <div className={`${styles.yieldBlock} ${styles[kind]}`}>
          <strong>
            {kindMeta.icon} {kindMeta.label}: {kindMeta.description}
          </strong>
          <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: 6 }}>{run.yieldRequest.reason}</p>

          {run.yieldRequest.options.map((opt) => (
            <div
              key={opt.id}
              className={`${styles.option} ${selectedOptionId === opt.id ? styles.optionSelected : ""}`}
              onClick={() => onSelectOption(opt.id)}
              role="radio"
              aria-checked={selectedOptionId === opt.id}
              tabIndex={0}
            >
              <strong>
                {selectedOptionId === opt.id ? "◉" : "○"} Option {opt.id}: {opt.label}
              </strong>
              {opt.detail && <div>{opt.detail}</div>}
              {opt.risk && <div style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>※Risk: {opt.risk}</div>}
            </div>
          ))}

          <div className={styles.yieldActions}>
            <button className={styles.primaryBtn} style={{ width: "auto" }} disabled={!selectedOptionId || deciding} onClick={onConfirmOption}>
              選択してStateを更新
            </button>
            <button className={styles.btnOutline} onClick={onFocusChat}>
              別の案をチャットで壁打ち
            </button>
          </div>
        </div>
        );
      })()}

      {run.status === "idle" && run.proposal && (
        <div className={styles.proposalBlock}>
          <strong>✅ 結論</strong>
          <p style={{ fontSize: "0.8125rem", marginTop: 4 }}>{run.proposal.conclusion}</p>

          {run.proposal.facts.length > 0 && (
            <>
              <strong style={{ fontSize: "0.75rem" }}>参照ファクト</strong>
              <ul style={{ margin: "4px 0 8px 18px", fontSize: "0.75rem" }}>
                {run.proposal.facts.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
            </>
          )}

          <strong style={{ fontSize: "0.75rem" }}>判断ロジック</strong>
          <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: "4px 0 8px" }}>{run.proposal.logic}</p>

          {run.proposal.rejectedAlternatives.length > 0 && (
            <>
              <strong style={{ fontSize: "0.75rem" }}>棄却した代替案</strong>
              {run.proposal.rejectedAlternatives.map((r, i) => (
                <div key={i} style={{ fontSize: "0.75rem", marginTop: 4 }}>
                  <strong>{r.option}</strong>
                  <span style={{ color: "var(--text-muted)" }}> — {r.reason}</span>
                </div>
              ))}
            </>
          )}

          {run.suggestedActionItems && run.suggestedActionItems.length > 0 && (
            <div className={styles.yieldBlock} style={{ marginTop: 12 }}>
              <strong>💡 AIが提案するAction Items</strong>
              <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: 6 }}>
                採用すると先頭の1件が「次の一手」、残りは「あとでやる」に入ります。
              </p>
              <ul style={{ margin: "6px 0 8px 18px", fontSize: "0.75rem" }}>
                {run.suggestedActionItems.map((item, i) => (
                  <li key={i}>
                    {i === 0 ? <strong>次の一手: </strong> : null}
                    {item}
                  </li>
                ))}
              </ul>
              <div className={styles.yieldActions}>
                <button
                  className={styles.primaryBtn}
                  style={{ width: "auto" }}
                  disabled={actionItemsSubmitting}
                  onClick={() => onAdoptActionItems?.(run.suggestedActionItems ?? [])}
                >
                  採用する（先頭を次の一手に）
                </button>
                <button className={styles.btnOutline} disabled={actionItemsSubmitting} onClick={onDismissActionItems}>
                  却下する
                </button>
              </div>
            </div>
          )}

          {run.suggestedSubIssues && run.suggestedSubIssues.length > 0 && (
            <div className={styles.yieldBlock} style={{ marginTop: 12 }}>
              <strong>🔭 AIが提案する分解案（サブIssue）</strong>
              <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: 6 }}>
                独自の Why/What/How を持つ別の介入として切り出す案です。この介入の「次の一手」なら Action Item のままにしてください。採用すると実際にサブIssueが作成されます（優先度も一緒に反映）。
              </p>
              <ul style={{ margin: "6px 0 8px 18px", fontSize: "0.75rem" }}>
                {run.suggestedSubIssues.map((item, i) => {
                  const p = item.priority ? ISSUE_PRIORITY_META[item.priority] : undefined;
                  return (
                    <li key={i}>
                      {item.title}
                      {p ? (
                        <span style={{ color: "var(--text-muted)", marginLeft: 6 }}>
                          {p.icon} {p.label}
                        </span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
              <div className={styles.yieldActions}>
                <button
                  className={styles.primaryBtn}
                  style={{ width: "auto" }}
                  disabled={subIssuesSubmitting}
                  onClick={() => onAdoptSubIssues?.(run.suggestedSubIssues ?? [])}
                >
                  採用してサブIssueを作成
                </button>
                <button className={styles.btnOutline} disabled={subIssuesSubmitting} onClick={onDismissSubIssues}>
                  却下する
                </button>
              </div>
            </div>
          )}

          {run.suggestedPriority && (
            <div className={styles.yieldBlock} style={{ marginTop: 12 }}>
              <strong>🔥 AIが提案する優先度</strong>
              <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: 6 }}>
                今週〜今月の介入ポートフォリオ上の位置づけです。採用するとIssueの優先度に反映されます。
              </p>
              <p style={{ fontSize: "0.8125rem", marginTop: 6 }}>
                {ISSUE_PRIORITY_META[run.suggestedPriority].icon} {ISSUE_PRIORITY_META[run.suggestedPriority].label}
                <span style={{ color: "var(--text-muted)", marginLeft: 8 }}>
                  — {ISSUE_PRIORITY_META[run.suggestedPriority].hint}
                </span>
              </p>
              <div className={styles.yieldActions}>
                <button
                  className={styles.primaryBtn}
                  style={{ width: "auto" }}
                  disabled={prioritySubmitting}
                  onClick={() => onAdoptPriority?.(run.suggestedPriority!)}
                >
                  採用して優先度に反映
                </button>
                <button className={styles.btnOutline} disabled={prioritySubmitting} onClick={onDismissPriority}>
                  却下する
                </button>
              </div>
            </div>
          )}

          {run.suggestedCharter && Object.keys(run.suggestedCharter).length > 0 && (
            <div className={styles.yieldBlock} style={{ marginTop: 12 }}>
              <strong>📝 AIが提案するWhy/What/How</strong>
              <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: 6 }}>
                未整理だった項目の埋め合わせ案です。採用すると、この項目だけIssueのWhy/What/Howに反映されます（既に書かれている項目は上書きしません）。
              </p>
              {(["why", "what", "how"] as const).map(
                (key) =>
                  run.suggestedCharter?.[key] && (
                    <div key={key} style={{ fontSize: "0.75rem", marginTop: 6 }}>
                      <strong>{CHARTER_FIELD_LABEL[key]}</strong>
                      <p style={{ margin: "2px 0 0" }}>{run.suggestedCharter[key]}</p>
                    </div>
                  ),
              )}
              <div className={styles.yieldActions}>
                <button
                  className={styles.primaryBtn}
                  style={{ width: "auto" }}
                  disabled={charterSubmitting}
                  onClick={() => onAdoptCharter?.(run.suggestedCharter ?? {})}
                >
                  採用してWhy/What/Howに反映
                </button>
                <button className={styles.btnOutline} disabled={charterSubmitting} onClick={onDismissCharter}>
                  却下する
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {run.status === "active" && stale && (
        <p className={styles.errorText} role="alert">
          ❔ 応答なし: しばらくログが更新されていません。動いているように見えて実際は止まっている可能性があります。
        </p>
      )}
      {run.status === "active" && !stale && <p className={styles.subtitle}>エージェントが検討中です…</p>}
      {run.status === "queued" && (
        <p className={styles.subtitle}>⏳ 同時実行数の上限のため、順番待ちです。他のAgent Runが完了すると自動的に起動します。</p>
      )}
      {run.status === "error" && (
        <div>
          <p className={styles.errorText} role="alert">エラーで終了しました。右のログを確認してください。</p>
          {onRetry && (
            <button className={styles.btnOutline} disabled={deciding} onClick={onRetry}>
              {deciding ? "再試行中…" : "🔁 同じ内容で再試行する"}
            </button>
          )}
        </div>
      )}
    </>
  );
}

type ChatTurn = { kind: "user" | "ai" | "note"; text: string };

// docs 3.5のExplainability方針（何も隠さない）は保ちつつ、ワイヤーフレームの
// 「Copilot Workspace」が意図する対話的な見た目に寄せる。タスク受理／EMからの入力は
// ユーザー発言、agentチャンネルはAIの発言として吹き出し表示し、それ以外の
// system/metaログ（起動・匿名化・完了通知等）は小さな注記として発言の間に薄く表示する。
// yield/proposal/consultの機械可読ブロックはExecution State側で構造化表示するので、
// チャット吹き出しでは自然文の説明部分だけを見せて二重表示を避ける。
function stripStructuredBlocks(text: string): string {
  return text.replace(/```(?:yield|proposal|consult|action_items|charter)\s*\n?[\s\S]*?```/g, "").trim();
}

function buildChatTurns(log: LogLine[]): ChatTurn[] {
  return log.flatMap((line): ChatTurn[] => {
    if (line.channel === "agent") {
      const text = stripStructuredBlocks(line.text);
      return text ? [{ kind: "ai", text }] : [];
    }
    if (line.channel === "meta" && line.text.startsWith("タスクを受理: ")) {
      return [{ kind: "user", text: line.text.replace(/^タスクを受理: /, "") }];
    }
    if (line.channel === "meta" && line.text.startsWith("EMからの入力: ")) {
      return [{ kind: "user", text: line.text.replace(/^EMからの入力: /, "") }];
    }
    return [{ kind: "note", text: line.text }];
  });
}

// docs/first_implession/em_ui_wireframe_v5.html の「Copilot Workspace (Interactive)」に対応。
export function CopilotChat({
  run,
  message,
  setMessage,
  deciding,
  onDecide,
  inputId,
}: {
  run: AgentRun;
  message: string;
  setMessage: (value: string) => void;
  deciding: boolean;
  onDecide: (text: string) => void;
  inputId?: string;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const turns = buildChatTurns(run.log);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [run.log.length]);

  return (
    <>
      <div className={styles.chatScroll} ref={scrollRef}>
        {turns.map((turn, i) =>
          turn.kind === "note" ? (
            <div key={i} className={styles.chatNote}>
              {turn.text}
            </div>
          ) : (
            <div key={i} className={`${styles.chatBubble} ${turn.kind === "user" ? styles.chatBubbleUser : styles.chatBubbleAi}`}>
              {turn.kind === "ai" && <strong className={styles.chatBubbleSender}>[{run.agentName}]</strong>}
              {turn.text}
            </div>
          ),
        )}
        {run.status === "active" && <div className={styles.chatNote}>&gt;_ 応答を待っています…</div>}
        {run.status === "queued" && <div className={styles.chatNote}>&gt;_ ⏳ 順番待ちです（同時実行数の上限）…</div>}
      </div>

      {run.status !== "active" && run.status !== "queued" && (
        <div className={styles.chatRow}>
          <textarea
            id={inputId}
            placeholder={run.status === "yield" ? "別の案をチャットで壁打ち…" : "追加で相談する…"}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={3}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing && e.keyCode !== 229) {
                e.preventDefault();
                onDecide(message);
              }
            }}
          />
          <button
            className={styles.primaryBtn}
            style={{ width: "auto" }}
            disabled={deciding || !message.trim()}
            onClick={() => onDecide(message)}
          >
            Send
          </button>
        </div>
      )}
    </>
  );
}
