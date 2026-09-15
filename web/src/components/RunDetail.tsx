"use client";

import { useEffect, useRef } from "react";
import styles from "@/app/page.module.css";
import { IdLinkedText } from "@/components/IdLinkedText";
import { MarkdownView } from "@/components/MarkdownView";
import {
  issueTitleFromConclusion,
  YIELD_KIND_META,
  type IssuePriority,
  type YieldKind,
} from "@/lib/types";
import { listIssueCandidatesFromProposal, resolveYieldKind } from "./run-detail/run-view-helpers";
import { YieldBlock } from "./run-detail/YieldBlock";
import { ProposalBlock } from "./run-detail/ProposalBlock";
import { SuggestedSubIssuesBlock } from "./run-detail/SuggestedSubIssuesBlock";
import { SuggestedCharterBlock } from "./run-detail/SuggestedCharterBlock";
import { SuggestedThemesBlock } from "./run-detail/SuggestedThemesBlock";
import { SuggestedIssueNotesBlock } from "./run-detail/SuggestedIssueNotesBlock";

export { listIssueCandidatesFromProposal, resolveYieldKind };

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
  // Issue化時の短い課題名。無い場合は conclusion からヒューリスティックで作る。
  issueTitle?: string;
  // 親なしの独立Issue候補（複数）。ある場合は issueTitle より優先して起票UIに出す。
  issueCandidates?: { title: string; rationale?: string }[];
};

export type SuggestedSubIssue = {
  title: string;
  priority?: IssuePriority;
};

export type SuggestedTheme = {
  title: string;
  summary: string;
  rationale: string;
  facts: string[];
  rootCause?: string;
  suggestedDirection?: string;
  evidenceJournalIds?: string[];
  evidenceIssueIds?: string[];
};

// docs/memo.md「Agentが相談などから他Issueなどへ記録することができない」対応。
export type SuggestedIssueNote = {
  issueId: string;
  text: string;
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
  suggestedThemes?: SuggestedTheme[];
  suggestedIssueNotes?: SuggestedIssueNote[];
  totalCostUsd: number;
  createdAt: number;
  updatedAt: number;
  consultedBy?: string;
  origin: "manual" | "auto-anomaly" | "auto-summary" | "auto-issue-update" | "auto-distill";
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
// 前の定型句だけが残ってしまう。proposal.issueTitle（短い課題名）があれば最優先。
// 無ければ conclusion から判断メタを除いた候補を使い、それも無ければ task 等へ落ちる。
export function runFallbackTitle(run: AgentRun): string {
  const issueTitle = run.proposal?.issueTitle?.trim();
  if (issueTitle) return issueTitle;
  const firstCandidate = listIssueCandidatesFromProposal(run.proposal)[0]?.title;
  if (firstCandidate) return firstCandidate;
  const conclusion = run.proposal?.conclusion.trim();
  if (conclusion) return issueTitleFromConclusion(conclusion);
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
  if (run.origin === "auto-issue-update") return "提案更新分析";
  if (run.origin === "auto-distill") return "状況蒸留";
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
 * ダッシュボード／相談の「ドラフト提案」語彙。
 * idle完了＝起票待ち、active/queued＝分析中。yield/error は従来の種別ラベルを優先。
 */
export function draftKindLabel(run: AgentRun): string {
  if (!isDraftAwaitingTriage(run)) return runKindLabel(run);
  if (run.status === "active" || run.status === "queued") return "ドラフト分析中";
  if (run.status === "idle") return "ドラフト提案";
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
  onAdoptSubIssues,
  onDismissSubIssues,
  subIssuesSubmitting,
  onAdoptCharter,
  onDismissCharter,
  charterSubmitting,
  onAdoptThemes,
  onDismissThemes,
  themesSubmitting,
  onAdoptIssueNotes,
  onDismissIssueNotes,
  onMarkHandledIssueNotes,
  issueNotesSubmitting,
}: {
  run: AgentRun;
  selectedOptionId: string | null;
  onSelectOption: (id: string) => void;
  onConfirmOption: () => void;
  onFocusChat: () => void;
  deciding: boolean;
  stale?: boolean;
  onRetry?: () => void;
  onAdoptSubIssues?: (items: SuggestedSubIssue[]) => void;
  onDismissSubIssues?: () => void;
  subIssuesSubmitting?: boolean;
  onAdoptCharter?: (charter: { why?: string; what?: string; how?: string }) => void;
  onDismissCharter?: () => void;
  charterSubmitting?: boolean;
  onAdoptThemes?: () => void;
  onDismissThemes?: () => void;
  themesSubmitting?: boolean;
  onAdoptIssueNotes?: (indices: number[]) => void;
  onDismissIssueNotes?: (indices: number[]) => void;
  onMarkHandledIssueNotes?: (indices: number[]) => void;
  issueNotesSubmitting?: boolean;
}) {
  return (
    <>
      <p className={styles.contextText}>
        <strong>Context:</strong> <IdLinkedText text={run.task} />
      </p>

      {run.status === "yield" && run.yieldRequest && (
        <YieldBlock
          yieldRequest={run.yieldRequest}
          selectedOptionId={selectedOptionId}
          onSelectOption={onSelectOption}
          onConfirmOption={onConfirmOption}
          onFocusChat={onFocusChat}
          deciding={deciding}
        />
      )}

      {run.status === "idle" && run.proposal && (
        <div className={styles.proposalBlock}>
          <ProposalBlock proposal={run.proposal} />

          {onAdoptSubIssues && run.suggestedSubIssues && run.suggestedSubIssues.length > 0 && (
            <SuggestedSubIssuesBlock
              items={run.suggestedSubIssues}
              onAdopt={onAdoptSubIssues}
              onDismiss={onDismissSubIssues}
              submitting={subIssuesSubmitting}
            />
          )}

          {onAdoptCharter && run.suggestedCharter && Object.keys(run.suggestedCharter).length > 0 && (
            <SuggestedCharterBlock
              charter={run.suggestedCharter}
              onAdopt={onAdoptCharter}
              onDismiss={onDismissCharter}
              submitting={charterSubmitting}
            />
          )}

          {run.suggestedThemes && run.suggestedThemes.length > 0 && (
            <SuggestedThemesBlock
              themes={run.suggestedThemes}
              onAdopt={onAdoptThemes}
              onDismiss={onDismissThemes}
              submitting={themesSubmitting}
              onFocusChat={onFocusChat}
            />
          )}

          {onAdoptIssueNotes && run.suggestedIssueNotes && run.suggestedIssueNotes.length > 0 && (
            <SuggestedIssueNotesBlock
              notes={run.suggestedIssueNotes}
              onAdopt={onAdoptIssueNotes}
              onDismiss={onDismissIssueNotes}
              onMarkHandled={onMarkHandledIssueNotes}
              submitting={issueNotesSubmitting}
            />
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
              {/* Journal/charterと同じMarkdownView。remark-breaksで単一改行も<br>として残す。 */}
              <MarkdownView text={turn.text} />
            </div>
          ) : (
            <div key={i} className={`${styles.chatBubble} ${turn.kind === "user" ? styles.chatBubbleUser : styles.chatBubbleAi}`}>
              {turn.kind === "ai" && <strong className={styles.chatBubbleSender}>[{run.agentName}]</strong>}
              <MarkdownView text={turn.text} />
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
