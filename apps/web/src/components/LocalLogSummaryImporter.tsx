import { useState } from "react";
import styles from "../styles/page.module.css";
import { api } from "../lib/api-client";
import { useNameCandidateConfirm } from "../lib/useNameCandidateConfirm";
import { RecordDateField } from "./RecordDateField";
import type { JournalLocalSummarizeResponse } from "@emther/api-contract";

type Props = {
  onCreated: () => void;
};

/**
 * 議事録・長文ログのローカル要約インポーター
 * 機微な個人情報や会話の生ログを外部AIやストレージに蓄積せず
 * ローカル環境で「決定事項・シグナル・ネクストアクション」に要約したうえで
 * EMが手直ししてジャーナルに登録する
 * 元実装は<RecordDateField>へ実際には存在しないprops名
 * （`value`/`onChange`）を渡しており、かつ独自のdateOpen開閉UIを外側に重ねて実装していた
 * （web側の既存5件の型エラーの1つ、DailyReflectionForm.tsxと同種の誤り）。移植にあたり
 * 同じRecordDateFieldを正しく使っている他コンポーネント（EmCheckinWidget.tsx等）と同じ
 * パターン（`open`/`onOpen`/`onDateChange`/`onReset`）に揃え、外側の独自開閉UIは削除した
 * （RecordDateField自身が開閉状態の表示を担うため不要だった）
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
      const res = await api.api.journal["local-summarize"].$post({
        json: { text: trimmed, mode: "log" },
      });
      const data = (await res.json().catch(() => null)) as (JournalLocalSummarizeResponse & { error?: string }) | null;
      if (!res.ok) throw new Error(data?.error ?? "ローカル要約に失敗しました");
      setSummaryText(data?.summary ?? "");
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

        <RecordDateField
          open={dateOpen}
          date={date}
          onOpen={() => setDateOpen(true)}
          onDateChange={setDate}
          onReset={() => {
            setDate("");
            setDateOpen(false);
          }}
          openLabel="📅 日付を変更"
        />
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
