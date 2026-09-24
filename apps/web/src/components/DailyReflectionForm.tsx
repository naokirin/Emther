import { useEffect, useRef, useState } from "react";
import styles from "../styles/page.module.css";
import { api, rpcData } from "../lib/api-client";
import { useNameCandidateConfirm } from "../lib/useNameCandidateConfirm";
import { RecordDateField } from "./RecordDateField";
import { todayDateInputValue } from "./recordDate";
import type { ReflectionTurn } from "@emther/core/local-summarizer";
import type { JournalLocalSummarizeResponse } from "@emther/api-contract";

// web/src/components/DailyReflectionForm.tsx（Next.js版）からの移植（フェーズ3.5
// evening-reviewバッチ）。stylesのimportパス・`@core/*`のbare specifier化以外の
// ロジックは変更していないが、1点だけ既存の不具合を修正した:
// 元実装は<RecordDateField>へ`dateOpen`/`onToggleDateOpen`/`onChangeDate`という
// 存在しないprops名を渡しており（RecordDateFieldの実際のpropsは`open`/`onOpen`/
// `onDateChange`/`onReset`）、`onOpen`が未指定のままボタンを押すとランタイムエラーに
// なる状態だった（web側の`tsc --noEmit`で検出済みの既存の型エラー、
// docs/2nd_architecture/checklist.md フェーズ1.7の「web側の既存5件」の1つ）。
// 同じRecordDateFieldを正しく使っている EmCheckinWidget.tsx / ReflectionNoteForm.tsx
// と同じパターン（onOpenで初期値をセットしつつ開く、onResetで値と開閉状態を両方戻す）に揃えた。
type Props = {
  onCreated: () => void;
};

type Phase = "idle" | "chat" | "review";

/**
 * 1日の終わりのAI対話リフレクション（振り返り）フォーム。
 * EMが日々の出来事を逐一記録するのではなく、「振り返りを始める」を押すとAIが
 * 「お疲れ様でした、今日はどんな一日でしたか？」と語りかけ、チャット上の回答だけを
 * もとに、無理に深掘りせず幅広く今日の出来事・メンバー・判断・気づきを引き出す。
 * Journal 等の別コンテキストは混ぜない（問いかけの文脈混同を避けるため）。
 */
export function DailyReflectionForm({ onCreated }: Props) {
  const { fetchWithNameConfirm, nameCandidateDialog } = useNameCandidateConfirm();

  const [phase, setPhase] = useState<Phase>("idle");
  const [messages, setMessages] = useState<ReflectionTurn[]>([]);
  const [currentInput, setCurrentInput] = useState("");
  const [structuredText, setStructuredText] = useState("");

  const [dateOpen, setDateOpen] = useState(false);
  const [date, setDate] = useState("");
  const [sensitive, setSensitive] = useState(false);
  const [asking, setAsking] = useState(false);
  const [structuring, setStructuring] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chatListRef = useRef<HTMLDivElement>(null);

  // メッセージ表示部分（内部スクロール領域）でメッセージが増えてスクロールが必要になったとき、
  // メッセージ表示領域の内部だけを最下部へ自動スクロールする（画面全体のスクロールや入力欄へのスクロールは一切行わない）。
  useEffect(() => {
    if (phase === "chat" && chatListRef.current) {
      const el = chatListRef.current;
      if (el.scrollHeight > el.clientHeight) {
        if (typeof el.scrollTo === "function") {
          el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
        } else {
          el.scrollTop = el.scrollHeight;
        }
      }
    }
  }, [messages, asking, phase]);

  async function handleStart() {
    setAsking(true);
    setError(null);
    try {
      const res = await api.api.journal["local-summarize"].$post({
        json: {
          mode: "question",
          history: [],
        },
      });
      const data = await rpcData<JournalLocalSummarizeResponse & { error?: string }>(res);
      const question =
        data?.question ??
        "お疲れ様でした！今日も一日お疲れ様でした。今日はどんな一日でしたか？（印象に残っている出来事や、全体の雰囲気など、ざっくりとした一言でも構いません）";

      setMessages([{ role: "assistant", content: question }]);
      setPhase("chat");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAsking(false);
    }
  }

  async function handleSendReply() {
    const trimmed = currentInput.trim();
    if (!trimmed || asking) return;

    const updatedHistory: ReflectionTurn[] = [
      ...messages,
      { role: "user", content: trimmed },
    ];
    setMessages(updatedHistory);
    setCurrentInput("");
    setAsking(true);
    setError(null);

    try {
      const res = await api.api.journal["local-summarize"].$post({
        json: {
          mode: "question",
          history: updatedHistory,
        },
      });
      const data = await rpcData<JournalLocalSummarizeResponse & { error?: string }>(res);
      const nextQuestion =
        data?.question ??
        "ありがとうございます。今日を振り返って、心残りや、ふと引っかかった違和感、明日以降に意識したいモヤモヤ・気づきなどはありますか？特になければ、このまま本日の振り返りとしてまとめますね。";

      setMessages([...updatedHistory, { role: "assistant", content: nextQuestion }]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAsking(false);
    }
  }

  async function handleSynthesize() {
    const userMessages = messages.filter((m) => m.role === "user").map((m) => m.content);
    if (userMessages.length === 0) return;

    setStructuring(true);
    setError(null);

    try {
      const combinedText = userMessages.join("\n\n");
      const res = await api.api.journal["local-summarize"].$post({
        json: { text: combinedText, mode: "reflection" },
      });
      const data = await rpcData<JournalLocalSummarizeResponse & { error?: string }>(res);
      if (!res.ok) throw new Error(data?.error ?? "振り返りの整理に失敗しました");

      setStructuredText(data?.summary ?? "");
      setPhase("review");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setStructuring(false);
    }
  }

  async function handleSave() {
    const textToSave = structuredText.trim();
    if (!textToSave) return;

    setSaving(true);
    setError(null);
    try {
      const finalText = `[1日の振り返り]\n${textToSave}`;
      const { res, data } = await fetchWithNameConfirm(
        "/api/journal",
        {
          method: "POST",
          body: {
            text: finalText,
            occurredAtDate: date || undefined,
            ...(sensitive ? { sensitive: true } : {}),
          },
        },
        "保存する",
      );
      if (!res.ok) throw new Error((data as { error?: string } | null)?.error ?? "保存に失敗しました");

      setMessages([]);
      setCurrentInput("");
      setStructuredText("");
      setPhase("idle");
      setDate("");
      setDateOpen(false);
      setSensitive(false);
      onCreated();
    } catch (err) {
      if ((err as Error).message !== "人名候補の確認をキャンセルしました") {
        setError((err as Error).message);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* 共通ガイダンスヘッダー */}
      <div
        style={{
          padding: "12px 14px",
          backgroundColor: "var(--surface)",
          borderRadius: 8,
          border: "1px solid var(--border)",
          borderLeft: "4px solid var(--accent)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
          <span style={{ fontSize: "1.1rem" }}>🌙</span>
          <strong style={{ fontSize: "0.95rem" }}>1日の終わりの振り返り（AI対話リフレクション）</strong>
        </div>
        <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", margin: "0 0 6px" }}>
          日々の出来事を逐一記録する必要はありません。AIの問いかけに答えながら、今日あったこと・判断したこと・気づきを短文で気軽に思い起こしましょう。
        </p>
      </div>

      {error && (
        <p className={styles.errorText} role="alert">
          {error}
        </p>
      )}

      {/* Phase 1: 初期待機状態 */}
      {phase === "idle" && (
        <div
          style={{
            padding: "20px 16px",
            textAlign: "center",
            background: "var(--bg-subtle, rgba(0,0,0,0.02))",
            borderRadius: 8,
            border: "1px dashed var(--border)",
          }}
        >
          <p style={{ fontSize: "0.9rem", color: "var(--text)", marginBottom: 14 }}>
            業務の終わりに、AIと一緒に今日をサクッと振り返りませんか？
          </p>
          <button
            type="button"
            className={styles.primaryBtn}
            style={{ width: "auto", padding: "10px 24px", fontSize: "0.95rem" }}
            disabled={asking}
            onClick={() => void handleStart()}
          >
            {asking ? "準備中…" : "✨ 振り返りを始める"}
          </button>
        </div>
      )}

      {/* Phase 2: 対話セッション */}
      {phase === "chat" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {/* チャット履歴 */}
          <div
            ref={chatListRef}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
              maxHeight: 380,
              overflowY: "auto",
              padding: "10px 12px",
              backgroundColor: "var(--bg-subtle, rgba(0,0,0,0.02))",
              borderRadius: 8,
              border: "1px solid var(--border)",
            }}
          >
            {messages.map((m, idx) => (
              <div
                key={idx}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: m.role === "user" ? "flex-end" : "flex-start",
                }}
              >
                <div
                  style={{
                    fontSize: "0.75rem",
                    color: "var(--text-muted)",
                    marginBottom: 2,
                    padding: "0 4px",
                  }}
                >
                  {m.role === "assistant" ? "🤖 AIパートナー" : "👤 あなた"}
                </div>
                <div
                  style={{
                    maxWidth: "85%",
                    padding: "10px 14px",
                    borderRadius: 8,
                    fontSize: "0.875rem",
                    lineHeight: 1.5,
                    whiteSpace: "pre-wrap",
                    backgroundColor: m.role === "user" ? "var(--accent, #2563eb)" : "var(--surface)",
                    color: m.role === "user" ? "#fff" : "var(--fg)",
                    border: m.role === "assistant" ? "1px solid var(--border)" : "none",
                  }}
                >
                  {m.content}
                </div>
              </div>
            ))}

            {asking && (
              <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", padding: "4px 8px" }}>
                <span className={styles.spinner} aria-hidden /> AIが質問を準備しています…
              </div>
            )}
          </div>

          {/* 入力欄 */}
          <div className={styles.field} style={{ margin: 0 }}>
            <textarea
              value={currentInput}
              onChange={(e) => setCurrentInput(e.target.value)}
              placeholder="回答を入力（短文や箇条書きで大丈夫です。Enterで改行）..."
              rows={3}
              disabled={asking || structuring}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                  e.preventDefault();
                  void handleSendReply();
                }
              }}
            />
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                className={styles.primaryBtn}
                style={{ width: "auto" }}
                disabled={asking || structuring || !currentInput.trim()}
                onClick={() => void handleSendReply()}
              >
                {asking ? "送信中…" : "送信（回答する）"}
              </button>
              {messages.some((m) => m.role === "user") && (
                <button
                  type="button"
                  className={styles.btnOutline}
                  style={{ width: "auto" }}
                  disabled={structuring || asking}
                  onClick={() => void handleSynthesize()}
                >
                  {structuring ? "整理中…" : "📝 この内容で振り返りをまとめる"}
                </button>
              )}
            </div>
            <button
              type="button"
              className={styles.detailToggle}
              style={{ fontSize: "0.75rem" }}
              onClick={() => {
                if (confirm("対話を終了してリセットしますか？")) {
                  setPhase("idle");
                  setMessages([]);
                  setCurrentInput("");
                }
              }}
            >
              やり直す
            </button>
          </div>
        </div>
      )}

      {/* Phase 3: 整理・確定保存 */}
      {phase === "review" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div
            style={{
              padding: "10px 12px",
              backgroundColor: "var(--bg-subtle, rgba(0,0,0,0.02))",
              borderRadius: 6,
              fontSize: "0.85rem",
              color: "var(--text-muted)",
            }}
          >
            対話内容を構造化しました。内容を確認・手直しし、ジャーナルに保存してください。
          </div>

          <div className={styles.field}>
            <label>
              本日の振り返りメモ
              <textarea
                value={structuredText}
                onChange={(e) => setStructuredText(e.target.value)}
                rows={7}
                disabled={saving}
                style={{ width: "100%", fontSize: "0.9rem", lineHeight: 1.6 }}
              />
            </label>
          </div>

          <RecordDateField
            open={dateOpen}
            date={date}
            onOpen={() => {
              setDate((prev) => prev || todayDateInputValue());
              setDateOpen(true);
            }}
            onDateChange={setDate}
            onReset={() => {
              setDate("");
              setDateOpen(false);
            }}
          />

          <label
            style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.75rem", color: "var(--text-muted)" }}
          >
            <input type="checkbox" checked={sensitive} onChange={(e) => setSensitive(e.target.checked)} disabled={saving} />
            センシティブ（一覧に出さない）
          </label>

          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button
              type="button"
              className={styles.primaryBtn}
              style={{ width: "auto" }}
              disabled={saving || !structuredText.trim()}
              onClick={() => void handleSave()}
            >
              {saving ? "保存中…" : "この内容でジャーナルに保存"}
            </button>
            <button
              type="button"
              className={styles.btnOutline}
              style={{ width: "auto" }}
              disabled={saving}
              onClick={() => setPhase("chat")}
            >
              ← 対話に戻る
            </button>
          </div>
        </div>
      )}

      {nameCandidateDialog}
    </div>
  );
}
