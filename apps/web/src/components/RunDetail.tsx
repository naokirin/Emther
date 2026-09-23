import { useEffect, useRef } from "react";
import styles from "../styles/page.module.css";
import { IdLinkedText } from "./IdLinkedText";
import { MarkdownView } from "./MarkdownView";
import type {
  AgentRun,
  AgentStatus,
  LogLine,
} from "@emther/core/agent-runtime";
import type { Suggestion } from "@emther/core/types";
import { STATUS_META } from "./runDetailMeta";
import { YieldBlock } from "./run-detail/YieldBlock";
import { ProposalBlock } from "./run-detail/ProposalBlock";
import { PeriodReviewBlock } from "./run-detail/PeriodReviewBlock";
import { SuggestedThemesBlock } from "./run-detail/SuggestedThemesBlock";
import { SuggestedSuggestionNotesBlock } from "./run-detail/SuggestedSuggestionNotesBlock";
import { SuggestedSuggestionUpdatesBlock } from "./run-detail/SuggestedSuggestionUpdatesBlock";

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
// docs/first_implession/em_ui_wireframe_v5.html の Issue Workspace「Execution State」に対応。
// Context（このrunが何のタスクか）＋ Yieldの選択UI（ラジオ風カード＋共通の確定/壁打ちボタン）＋
// 通常完了時のProposalを表示する。Action Itemsは呼び出し側（提案がある場合のみ）で追加する。
export function ExecutionState({
  run,
  selectedOptionId,
  onSelectOption,
  onConfirmOption,
  onFocusChat,
  deciding,
  stale,
  onRetry,
  onAdoptThemes,
  onDismissThemes,
  themesSubmitting,
  onAdoptSuggestionNotes,
  onDismissSuggestionNotes,
  onMarkHandledSuggestionNotes,
  suggestionNotesSubmitting,
  onAdoptSuggestionUpdates,
  onDismissSuggestionUpdates,
  suggestionUpdatesSubmitting,
  currentSuggestions,
}: {
  run: AgentRun;
  selectedOptionId: string | null;
  onSelectOption: (id: string) => void;
  onConfirmOption: () => void;
  onFocusChat: () => void;
  deciding: boolean;
  stale?: boolean;
  onRetry?: () => void;
  onAdoptThemes?: () => void;
  onDismissThemes?: () => void;
  themesSubmitting?: boolean;
  onAdoptSuggestionNotes?: (indices: number[]) => void;
  onDismissSuggestionNotes?: (indices: number[]) => void;
  onMarkHandledSuggestionNotes?: (indices: number[]) => void;
  suggestionNotesSubmitting?: boolean;
  onAdoptSuggestionUpdates?: (indices: number[]) => void;
  onDismissSuggestionUpdates?: (indices: number[]) => void;
  suggestionUpdatesSubmitting?: boolean;
  // docs/suggestion_organize_via_consult.md。差分のbefore値表示用。呼び出し側
  // （ConsultReviewPanel）が保持済みのSuggestion一覧から作る
  // （未指定時はbefore値を「不明」として表示するだけで、反映自体には影響しない）。
  currentSuggestions?: Map<string, Suggestion>;
}) {
  return (
    <>
      {run.task ? (
        <details className={styles.contextDetails}>
          <summary className={styles.contextSummary}>
            Context（指示・前提）を確認する
          </summary>
          <p className={styles.contextText}>
            <strong>Context:</strong> <IdLinkedText text={run.task} />
          </p>
        </details>
      ) : null}

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

      {run.status === "idle" && (run.proposal || run.periodReview) && (
        <div className={styles.proposalBlock}>
          {run.proposal && <ProposalBlock proposal={run.proposal} />}
          {run.periodReview && <PeriodReviewBlock review={run.periodReview} />}

          {run.suggestedThemes && run.suggestedThemes.length > 0 && (
            <SuggestedThemesBlock
              themes={run.suggestedThemes}
              onAdopt={onAdoptThemes}
              onDismiss={onDismissThemes}
              submitting={themesSubmitting}
              onFocusChat={onFocusChat}
            />
          )}

          {onAdoptSuggestionNotes && run.suggestedSuggestionNotes && run.suggestedSuggestionNotes.length > 0 && (
            <SuggestedSuggestionNotesBlock
              notes={run.suggestedSuggestionNotes}
              onAdopt={onAdoptSuggestionNotes}
              onDismiss={onDismissSuggestionNotes}
              onMarkHandled={onMarkHandledSuggestionNotes}
              submitting={suggestionNotesSubmitting}
            />
          )}

          {onAdoptSuggestionUpdates && run.suggestedSuggestionUpdates && run.suggestedSuggestionUpdates.length > 0 && (
            <SuggestedSuggestionUpdatesBlock
              updates={run.suggestedSuggestionUpdates}
              currentSuggestions={currentSuggestions ?? new Map()}
              onAdopt={onAdoptSuggestionUpdates}
              onDismiss={onDismissSuggestionUpdates}
              submitting={suggestionUpdatesSubmitting}
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
  return text.replace(/```(?:yield|proposal|consult|action_items|charter|sub_issues)\s*\n?[\s\S]*?```/g, "").trim();
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
