"use client";

import { useState, type FormEvent } from "react";
import styles from "@/app/page.module.css";
import { useNameCandidateConfirm } from "@/lib/useNameCandidateConfirm";
import { JournalNameCandidateSuggestion } from "@/components/JournalNameCandidateSuggestion";
import type { JournalEntry } from "@/lib/types";

// docs/memo.md「J. Peopleを第一級ハブに」対応の一部。人物詳細画面から、この人物に
// 紐づくJournalをその場で追加できる（作成時にpeopleへ本人を明示付与）。
export function PersonJournalComposer({
  personName,
  onCreated,
}: {
  personName: string;
  onCreated: () => void;
}) {
  const { fetchWithNameConfirm, nameCandidateDialog } = useNameCandidateConfirm();
  const [text, setText] = useState("");
  const [occurredAtDate, setOccurredAtDate] = useState("");
  const [dateOpen, setDateOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [lastCreated, setLastCreated] = useState<{ entry: JournalEntry; nameCandidates: string[] } | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || pending) return;
    setPending(true);
    setError(null);
    setStatus(null);
    setLastCreated(null);
    try {
      const { res, data } = await fetchWithNameConfirm(
        "/api/journal",
        {
          method: "POST",
          body: {
            text: trimmed,
            occurredAtDate: occurredAtDate || undefined,
            people: [personName],
          },
        },
        "保存する",
      );
      if (!res.ok) throw new Error((data as { error?: string } | null)?.error ?? "記録に失敗しました");
      const payload = data as { entry: JournalEntry; nameCandidates?: string[] };
      if (payload.nameCandidates && payload.nameCandidates.length > 0) {
        setLastCreated({ entry: payload.entry, nameCandidates: payload.nameCandidates });
      }
      setText("");
      setOccurredAtDate("");
      setDateOpen(false);
      setStatus("記録しました（未確認）。タグ・緊急度はJournal一覧で校正できます。");
      onCreated();
    } catch (err) {
      if ((err as Error).message === "人名候補の確認をキャンセルしました") return;
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <form onSubmit={handleSubmit} style={{ marginBottom: 12 }}>
        <p className={styles.subtitle} style={{ marginBottom: 6 }}>
          {personName}に紐づくJournalとして記録します。本文に名前が無くても、この人物へ紐付きます。
        </p>
        <div className={styles.journalInputRow}>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            placeholder={`例: ${personName}との1on1で、進捗の遅れへの不安を聞いた…`}
            disabled={pending}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing && e.keyCode !== 229) {
                e.preventDefault();
                (e.currentTarget.form as HTMLFormElement | null)?.requestSubmit();
              }
            }}
          />
          <button className={styles.primaryBtn} style={{ width: "auto" }} type="submit" disabled={pending || !text.trim()}>
            {pending ? "記録中…" : "Submit"}
          </button>
        </div>
        {dateOpen ? (
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.75rem", color: "var(--text-muted)" }}>
              発生日
              <input
                type="date"
                value={occurredAtDate}
                onChange={(e) => setOccurredAtDate(e.target.value)}
                style={{ maxWidth: 160 }}
                disabled={pending}
              />
            </label>
            <button
              type="button"
              className={`${styles.detailToggle} ${styles.detailToggleButton}`}
              disabled={pending}
              onClick={() => {
                setOccurredAtDate("");
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
            disabled={pending}
            onClick={() => setDateOpen(true)}
          >
            📅 今日の話じゃない（発生日を変える）
          </button>
        )}
        {error && (
          <p className={styles.errorText} role="alert" style={{ marginTop: 6 }}>
            {error}
          </p>
        )}
        {status && (
          <p className={styles.subtitle} style={{ marginTop: 6 }} role="status">
            ✅ {status}
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
