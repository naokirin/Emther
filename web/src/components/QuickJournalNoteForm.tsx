"use client";

import { useState } from "react";
import styles from "@/app/page.module.css";
import { useNameCandidateConfirm } from "@/lib/useNameCandidateConfirm";
import { JournalProfileCandidateSuggestion } from "@/components/JournalProfileCandidateSuggestion";
import type { ProfileCandidate } from "@/lib/journal-store";

// docs/memo.md「現場メモのタブでも単発のメモ入力をしたい」対応。/journalには従来
// 「📥 観測を取り込む」（複数件をAIが解析するダンプ）しか無く、Dashboardの「メモする」に
// あるような単発の一言入力が無かった。Dashboardのように非同期・下書き一覧までは持たせず、
// このページ単体で完結する最小限の1件投稿フォームにする（結果は呼び出し元がrefreshSearch()
// で一覧を再取得する）。
//
// ユーザー指摘「折りたたみをやめて最初から表示したい」対応。自身での開閉は持たず、
// 呼び出し元（JournalInputSwitcher）のタブ切り替えで表示/非表示を制御する。
// 未登録人名は保存前ダイアログ（fetchWithNameConfirm）で完結する。
export function QuickJournalNoteForm({ onCreated }: { onCreated: () => void }) {
  const { fetchWithNameConfirm, nameCandidateDialog } = useNameCandidateConfirm();
  const [text, setText] = useState("");
  const [isImpression, setIsImpression] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);
  const [date, setDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastProfileCandidate, setLastProfileCandidate] = useState<ProfileCandidate | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    setSubmitting(true);
    setError(null);
    setLastProfileCandidate(null);
    try {
      const finalText = isImpression ? `[感想を含む] ${trimmed}` : trimmed;
      const { res, data } = await fetchWithNameConfirm(
        "/api/journal",
        { method: "POST", body: { text: finalText, occurredAtDate: date || undefined } },
        "保存する",
      );
      if (!res.ok) throw new Error((data as { error?: string } | null)?.error ?? "保存に失敗しました");
      const payload = data as { profileCandidate?: ProfileCandidate };
      if (payload.profileCandidate) {
        setLastProfileCandidate(payload.profileCandidate);
      }
      setText("");
      setIsImpression(false);
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
        <label
          style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.75rem", color: "var(--text-muted)", marginTop: 6 }}
        >
          <input type="checkbox" checked={isImpression} onChange={(e) => setIsImpression(e.target.checked)} />
          感想を含む（事実と分けて記録したい単なる印象・感想のときにチェック）
        </label>
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
        {lastProfileCandidate && (
          <JournalProfileCandidateSuggestion
            person={lastProfileCandidate.person}
            text={lastProfileCandidate.text}
          />
        )}
      </form>
      {nameCandidateDialog}
    </>
  );
}
