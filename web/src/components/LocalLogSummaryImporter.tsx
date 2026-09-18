"use client";

import { useState } from "react";
import styles from "@/app/page.module.css";
import { useNameCandidateConfirm } from "@/lib/useNameCandidateConfirm";
import { RecordDateField } from "@/components/RecordDateField";

type Props = {
  onCreated: () => void;
};

/**
 * 議事録・長文ログのローカル要約インポーター。
 * 機微な個人情報や会話の生ログを外部AIやストレージに蓄積せず、
 * ローカル環境で「決定事項・シグナル・ネクストアクション」に要約したうえで
 * EMが手直ししてジャーナルに登録する。
 */
export function LocalLogSummaryImporter({ onCreated }: Props) {
  const { fetchWithNameConfirm, nameCandidateDialog } = useNameCandidateConfirm();
  const [rawText, setRawText] = useState("");
  const [summaryText, setSummaryText] = useState("");
  const [dateOpen, setDateOpen] = useState(false);
  const [date, setDate] = useState("");
  const [summarizing, setSummarizing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSummarize() {
    const trimmed = rawText.trim();
    if (!trimmed) return;
    setSummarizing(true);
    setError(null);
    try {
      const res = await fetch("/api/journal/local-summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: trimmed, mode: "log" }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "ローカル要約に失敗しました");
      setSummaryText(data.summary ?? "");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSummarizing(false);
    }
  }

  async function handleSave() {
    const textToSave = summaryText.trim();
    if (!textToSave) return;
    setSaving(true);
    setError(null);
    try {
      const finalText = `[要約ログ]\n${textToSave}`;
      const { res, data } = await fetchWithNameConfirm(
        "/api/journal",
        {
          method: "POST",
          body: {
            text: finalText,
            occurredAtDate: date || undefined,
          },
        },
        "保存する",
      );
      if (!res.ok) throw new Error((data as { error?: string } | null)?.error ?? "保存に失敗しました");
      // 生ログは即時消去してディスクや外部に残さない
      setRawText("");
      setSummaryText("");
      setDate("");
      setDateOpen(false);
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
      <div
        style={{
          padding: "10px 14px",
          backgroundColor: "var(--surface)",
          borderRadius: 8,
          border: "1px solid var(--border)",
          borderLeft: "4px solid var(--accent)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span>🔒</span>
          <strong style={{ fontSize: "0.9rem" }}>機微情報保護・ローカル要約</strong>
        </div>
        <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", margin: "4px 0 0" }}>
          入力された議事録やチャットログはローカル環境（Transformers.js）でのみ処理されます。外部AIへの送信や生データの永続化は行われません。要約されたシグナルのみを手直しして保存します。
        </p>
      </div>

      <div className={styles.field}>
        <textarea
          value={rawText}
          onChange={(e) => setRawText(e.target.value)}
          placeholder="議事録やチャットログ等のテキストを貼り付けてください..."
          rows={6}
          disabled={summarizing || saving}
          style={{ width: "100%", fontSize: "0.85rem", lineHeight: 1.5 }}
        />
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button
          type="button"
          className={styles.primaryBtn}
          style={{ width: "auto" }}
          disabled={summarizing || saving || !rawText.trim()}
          onClick={() => void handleSummarize()}
        >
          {summarizing ? "ローカル要約中…" : "🔒 ローカルLLMで要約・シグナル抽出"}
        </button>

        {!dateOpen ? (
          <button
            type="button"
            className={styles.btnOutline}
            style={{ width: "auto", fontSize: "0.8rem" }}
            onClick={() => setDateOpen(true)}
          >
            📅 日付を変更
          </button>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <RecordDateField value={date} onChange={setDate} />
            <button
              type="button"
              className={styles.btnOutline}
              style={{ width: "auto", padding: "2px 8px", fontSize: "0.75rem" }}
              onClick={() => {
                setDate("");
                setDateOpen(false);
              }}
            >
              今日に戻す
            </button>
          </div>
        )}
      </div>

      {summaryText && (
        <div
          style={{
            marginTop: 8,
            padding: "12px 14px",
            backgroundColor: "var(--surface)",
            borderRadius: 8,
            border: "1px solid var(--border)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <strong style={{ fontSize: "0.85rem", color: "var(--accent)" }}>
              📋 抽出された要約シグナル（手直しして登録）
            </strong>
          </div>
          <textarea
            value={summaryText}
            onChange={(e) => setSummaryText(e.target.value)}
            rows={6}
            style={{ width: "100%", fontSize: "0.85rem", lineHeight: 1.5, marginBottom: 8 }}
          />
          <button
            type="button"
            className={styles.primaryBtn}
            style={{ width: "auto" }}
            disabled={saving || !summaryText.trim()}
            onClick={() => void handleSave()}
          >
            {saving ? "保存中…" : "手直ししてジャーナルに登録"}
          </button>
        </div>
      )}

      {error && (
        <p className={styles.errorText} role="alert" style={{ margin: 0 }}>
          {error}
        </p>
      )}

      {nameCandidateDialog}
    </div>
  );
}
