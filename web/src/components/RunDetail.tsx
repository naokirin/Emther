"use client";

import { useEffect, useRef } from "react";
import styles from "@/app/page.module.css";

export type AgentStatus = "active" | "yield" | "idle" | "error";

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
};

export type AgentRun = {
  id: string;
  agentName: string;
  task: string;
  status: AgentStatus;
  sessionId?: string;
  log: LogLine[];
  yieldRequest?: { reason: string; options: YieldOption[] };
  proposal?: Proposal;
  suggestedActionItems?: string[];
  suggestedSubIssues?: string[];
  totalCostUsd: number;
  createdAt: number;
  updatedAt: number;
  consultedBy?: string;
  origin: "manual" | "auto-anomaly" | "auto-summary";
  reviewed: boolean;
  triageStatus?: "watching" | "dismissed";
  triageAt?: number;
};

export const STATUS_META: Record<AgentStatus, { icon: string; label: string; cls: string }> = {
  active: { icon: "🟢", label: "Active", cls: styles.active },
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
  onAdoptSubIssues?: (items: string[]) => void;
  onDismissSubIssues?: () => void;
  subIssuesSubmitting?: boolean;
}) {
  return (
    <>
      <p className={styles.contextText}>
        <strong>Context:</strong> {run.task}
      </p>

      {run.status === "yield" && run.yieldRequest && (
        <div className={styles.yieldBlock}>
          <strong>⚠️ AI Yield: 判断をお願いします</strong>
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6 }}>{run.yieldRequest.reason}</p>

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
              {opt.risk && <div style={{ color: "var(--text-muted)", fontSize: 11 }}>※Risk: {opt.risk}</div>}
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
      )}

      {run.status === "idle" && run.proposal && (
        <div className={styles.proposalBlock}>
          <strong>✅ 結論</strong>
          <p style={{ fontSize: 13, marginTop: 4 }}>{run.proposal.conclusion}</p>

          {run.proposal.facts.length > 0 && (
            <>
              <strong style={{ fontSize: 12 }}>参照ファクト</strong>
              <ul style={{ margin: "4px 0 8px 18px", fontSize: 12 }}>
                {run.proposal.facts.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
            </>
          )}

          <strong style={{ fontSize: 12 }}>判断ロジック</strong>
          <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "4px 0 8px" }}>{run.proposal.logic}</p>

          {run.proposal.rejectedAlternatives.length > 0 && (
            <>
              <strong style={{ fontSize: 12 }}>棄却した代替案</strong>
              {run.proposal.rejectedAlternatives.map((r, i) => (
                <div key={i} style={{ fontSize: 12, marginTop: 4 }}>
                  <strong>{r.option}</strong>
                  <span style={{ color: "var(--text-muted)" }}> — {r.reason}</span>
                </div>
              ))}
            </>
          )}

          {run.suggestedActionItems && run.suggestedActionItems.length > 0 && (
            <div className={styles.yieldBlock} style={{ marginTop: 12 }}>
              <strong>💡 AIが提案するAction Items</strong>
              <ul style={{ margin: "6px 0 8px 18px", fontSize: 12 }}>
                {run.suggestedActionItems.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
              <div className={styles.yieldActions}>
                <button
                  className={styles.primaryBtn}
                  style={{ width: "auto" }}
                  disabled={actionItemsSubmitting}
                  onClick={() => onAdoptActionItems?.(run.suggestedActionItems ?? [])}
                >
                  採用してAction Itemsに追加
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
              <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6 }}>
                このIssueが抽象的なため、具体的な子Issueへの分解を提案しています。採用すると実際にサブIssueが作成されます。
              </p>
              <ul style={{ margin: "6px 0 8px 18px", fontSize: 12 }}>
                {run.suggestedSubIssues.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
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
        </div>
      )}

      {run.status === "active" && stale && (
        <p className={styles.errorText}>
          ❔ 応答なし: しばらくログが更新されていません。動いているように見えて実際は止まっている可能性があります。
        </p>
      )}
      {run.status === "active" && !stale && <p className={styles.subtitle}>エージェントが検討中です…</p>}
      {run.status === "error" && (
        <div>
          <p className={styles.errorText}>エラーで終了しました。右のログを確認してください。</p>
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
  return text.replace(/```(?:yield|proposal|consult|action_items)\s*\n?[\s\S]*?```/g, "").trim();
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
      </div>

      {run.status !== "active" && (
        <div className={styles.chatRow}>
          <input
            id={inputId}
            type="text"
            placeholder={run.status === "yield" ? "別の案をチャットで壁打ち…" : "追加で相談する…"}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onDecide(message);
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
