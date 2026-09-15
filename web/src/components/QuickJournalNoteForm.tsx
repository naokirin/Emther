"use client";

import { useState } from "react";
import styles from "@/app/page.module.css";
import { useNameCandidateConfirm } from "@/lib/useNameCandidateConfirm";
import { JournalNameCandidateSuggestion } from "@/components/JournalNameCandidateSuggestion";
import type { JournalEntry } from "@/lib/types";

// docs/memo.md「現場メモのタブでも単発のメモ入力をしたい」対応。/journalには従来
// 「📥 観測を取り込む」（複数件をAIが解析するダンプ）しか無く、Dashboardの「メモする」に
// あるような単発の一言入力が無かった。Dashboardのように非同期・下書き一覧までは持たせず、
// このページ単体で完結する最小限の1件投稿フォームにする（結果は呼び出し元がrefreshSearch()
// で一覧を再取得する）。
//
// ユーザー指摘「折りたたみをやめて最初から表示したい」対応。自身での開閉は持たず、
// 呼び出し元（JournalInputSwitcher）のタブ切り替えで表示/非表示を制御する。
export function QuickJournalNoteForm({ onCreated }: { onCreated: () => void }) {
  const { fetchWithNameConfirm, nameCandidateDialog } = useNameCandidateConfirm();
  const [text, setText] = useState("");
  const [dateOpen, setDateOpen] = useState(false);
  const [date, setDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastCreated, setLastCreated] = useState<{ entry: JournalEntry; nameCandidates: string[] } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    setSubmitting(true);
    setError(null);
    setLastCreated(null);
    try {
      const { res, data } = await fetchWithNameConfirm(
        "/api/journal",
        { method: "POST", body: { text: trimmed, occurredAtDate: date || undefined } },
        "保存する",
      );
      if (!res.ok) throw new Error((data as { error?: string } | null)?.error ?? "保存に失敗しました");
      const payload = data as { entry: JournalEntry; nameCandidates?: string[] };
      if (payload.nameCandidates && payload.nameCandidates.length > 0) {
        setLastCreated({ entry: payload.entry, nameCandidates: payload.nameCandidates });
      }
      setText("");
      setDate("");
      setDateOpen(false);
      onCreated();
    } catch (err) {
      if ((err as Error).message !== "人名候補の確認をキャンセルしました") {
        setError((err as Error).message);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <form onSubmit={handleSubmit}>
        <div className={styles.journalInputRow}>
          <textarea
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="例: 今日のAさんとの1on1で、リファクタリングが進まないことへの不満を聞いた…"
          />
        </div>
        {dateOpen ? (
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.75rem", color: "var(--text-muted)" }}>
              発生日
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ maxWidth: 160 }} />
            </label>
            <button
              type="button"
              className={`${styles.detailToggle} ${styles.detailToggleButton}`}
              onClick={() => {
                setDate("");
                setDateOpen(false);
              }}
            >
              今日に戻す
            </button>
          </div>
        ) : (
          <button
            type="button"
            className={`${styles.detailToggle} ${styles.detailToggleButton}`}
            style={{ marginTop: 6 }}
            onClick={() => setDateOpen(true)}
          >
            📅 今日の話じゃない（発生日を変える）
          </button>
        )}
        <div style={{ marginTop: 8 }}>
          <button className={styles.primaryBtn} style={{ width: "auto" }} type="submit" disabled={submitting || !text.trim()}>
            {submitting ? "保存中…" : "保存する"}
          </button>
        </div>
        {error && (
          <p className={styles.errorText} role="alert">
            {error}
          </p>
        )}
        {lastCreated && (
          <JournalNameCandidateSuggestion
            entryId={lastCreated.entry.id}
            people={lastCreated.entry.people}
            candidates={lastCreated.nameCandidates}
          />
        )}
      </form>
      {nameCandidateDialog}
    </>
  );
}
