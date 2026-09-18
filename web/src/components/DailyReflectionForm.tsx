"use client";

import { useState } from "react";
import styles from "@/app/page.module.css";
import { useNameCandidateConfirm } from "@/lib/useNameCandidateConfirm";
import { RecordDateField } from "@/components/RecordDateField";

type Props = {
  onCreated: () => void;
};

const SUGGESTED_PROMPTS = [
  "👥 メンバーの様子・1on1で気になった兆候",
  "🎯 EM自身が今日決めたこと・前に進めたこと",
  "⚠️ 今日引っかかった出来事・違和感・モヤモヤ",
];

/**
 * 1日の終わりのAI対話リフレクション（振り返り）フォーム。
 * EMが日々の出来事を逐一記録するのではなく、1日の終わりにAIの問いかけに答えながら
 * 「事実・やったこと・気づき」を引き出し、最小限のシグナルとしてジャーナルに残す。
 */
export function DailyReflectionForm({ onCreated }: Props) {
  const { fetchWithNameConfirm, nameCandidateDialog } = useNameCandidateConfirm();
  const [reflectionInput, setReflectionInput] = useState("");
  const [structuredText, setStructuredText] = useState("");
  const [dateOpen, setDateOpen] = useState(false);
  const [date, setDate] = useState("");
  const [structuring, setStructuring] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleStructure() {
    const trimmed = reflectionInput.trim();
    if (!trimmed) return;
    setStructuring(true);
    setError(null);
    try {
      const res = await fetch("/api/journal/local-summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: trimmed, mode: "reflection" }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "AIによる整理に失敗しました");
      setStructuredText(data.summary ?? "");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setStructuring(false);
    }
  }

  async function handleSave() {
    const textToSave = (structuredText || reflectionInput).trim();
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
          },
        },
        "保存する",
      );
      if (!res.ok) throw new Error((data as { error?: string } | null)?.error ?? "保存に失敗しました");
      setReflectionInput("");
      setStructuredText("");
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
          padding: "12px 14px",
          backgroundColor: "var(--surface)",
          borderRadius: 8,
          border: "1px solid var(--border)",
          borderLeft: "4px solid var(--accent)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
          <span style={{ fontSize: "1.1rem" }}>🌙</span>
          <strong style={{ fontSize: "0.95rem" }}>1日の終わりの振り返り（リフレクション）</strong>
        </div>
        <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", margin: "0 0 8px" }}>
          日々の出来事をすべて記録する必要はありません。AIの問いかけに答えながら、今日あったこと・判断したこと・気づきを短文や箇条書きで気楽に残してください。
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {SUGGESTED_PROMPTS.map((prompt) => (
            <span
              key={prompt}
              style={{
                fontSize: "0.75rem",
                padding: "2px 8px",
                backgroundColor: "var(--border)",
                borderRadius: 12,
                color: "var(--text-muted)",
              }}
            >
              {prompt}
            </span>
          ))}
        </div>
      </div>

      <div className={styles.field}>
        <textarea
          value={reflectionInput}
          onChange={(e) => setReflectionInput(e.target.value)}
          placeholder="例: 今日はAさんと評価面談。少し不安そうな表情だったので来週追加でフォロー1on1を設定した。またBさんに新アーキテクチャの選定を任せる方針を伝えて合意した。"
          rows={4}
          disabled={structuring || saving}
          style={{ width: "100%", fontSize: "0.9rem", lineHeight: 1.5 }}
        />
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button
          type="button"
          className={styles.primaryBtn}
          style={{ width: "auto" }}
          disabled={structuring || saving || !reflectionInput.trim()}
          onClick={() => void handleStructure()}
        >
          {structuring ? "AIが整理中…" : "✨ AIと整理・シグナル抽出する"}
        </button>

        <button
          type="button"
          className={styles.btnOutline}
          style={{ width: "auto" }}
          disabled={saving || !reflectionInput.trim()}
          onClick={() => void handleSave()}
        >
          {saving ? "保存中…" : "そのままジャーナルに記録"}
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

      {structuredText && (
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
              📝 AI整理結果（手直しして保存できます）
            </strong>
          </div>
          <textarea
            value={structuredText}
            onChange={(e) => setStructuredText(e.target.value)}
            rows={6}
            style={{ width: "100%", fontSize: "0.85rem", lineHeight: 1.5, marginBottom: 8 }}
          />
          <button
            type="button"
            className={styles.primaryBtn}
            style={{ width: "auto" }}
            disabled={saving || !structuredText.trim()}
            onClick={() => void handleSave()}
          >
            {saving ? "保存中…" : "🌙 この内容でジャーナルに確定保存"}
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
