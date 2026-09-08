"use client";

import { useState } from "react";
import styles from "@/app/page.module.css";
import { PaginationControls, usePagination } from "@/components/Pagination";
import { useEmCheckins } from "@/lib/hooks";

const SCALE_OPTIONS = [1, 2, 3, 4, 5];
const CHECKIN_PAGE_SIZE = 10;

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric" });
}

// docs/memo.md TODO「人間EM自体の成長に対する向き合いを作る。EM本人のバイタル、週次振り返りの
// 入力・改善方針機能を作る」対応。/growthのEM自身のバイタル（自己チェックイン）フォーム＋履歴。
export function EmCheckinWidget() {
  const { checkins, setCheckins } = useEmCheckins();

  const [mood, setMood] = useState(3);
  const [energy, setEnergy] = useState(3);
  const [stress, setStress] = useState(3);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recentCheckins = checkins.slice(0, 7);
  const avgMood = average(recentCheckins.map((c) => c.mood));
  const avgEnergy = average(recentCheckins.map((c) => c.energy));
  const avgStress = average(recentCheckins.map((c) => c.stress));

  const checkinPagination = usePagination(checkins, CHECKIN_PAGE_SIZE);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/em-self/checkins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mood, energy, stress, note }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "記録に失敗しました");
      setCheckins([data.checkin, ...checkins]);
      setNote("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <form onSubmit={handleSubmit}>
        <div className={styles.field}>
          <label>
            気分（1: 悪い 〜 5: 良い）
            <select value={mood} onChange={(e) => setMood(Number(e.target.value))}>
              {SCALE_OPTIONS.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className={styles.field}>
          <label>
            エネルギー（1: 低い 〜 5: 高い）
            <select value={energy} onChange={(e) => setEnergy(Number(e.target.value))}>
              {SCALE_OPTIONS.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className={styles.field}>
          <label>
            ストレス（1: 低い 〜 5: 高い）
            <select value={stress} onChange={(e) => setStress(Number(e.target.value))}>
              {SCALE_OPTIONS.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className={styles.field}>
          <label>
            メモ（任意）
            <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="例: 大きめの障害対応が続いて疲労気味" />
          </label>
        </div>
        <button className={styles.primaryBtn} type="submit" disabled={submitting}>
          {submitting ? "記録中…" : "記録する"}
        </button>
      </form>
      {error && (
        <p className={styles.errorText} role="alert">
          {error}
        </p>
      )}

      {recentCheckins.length > 0 && (
        <p className={styles.subtitle} style={{ marginTop: 10 }}>
          直近{recentCheckins.length}件の平均: 気分 {avgMood?.toFixed(1)} / エネルギー {avgEnergy?.toFixed(1)} / ストレス {avgStress?.toFixed(1)}
        </p>
      )}

      {checkins.length === 0 ? (
        <p className={styles.subtitle} style={{ marginTop: 12 }}>
          まだ記録がありません。
        </p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>日付</th>
                <th>気分</th>
                <th>エネルギー</th>
                <th>ストレス</th>
                <th>メモ</th>
              </tr>
            </thead>
            <tbody>
              {checkinPagination.pageItems.map((c) => (
                <tr key={c.id}>
                  <td className={styles.tableMuted}>{formatDate(c.createdAt)}</td>
                  <td>{c.mood}</td>
                  <td>{c.energy}</td>
                  <td>{c.stress}</td>
                  <td>{c.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <PaginationControls
        page={checkinPagination.page}
        totalPages={checkinPagination.totalPages}
        total={checkinPagination.total}
        rangeStart={checkinPagination.rangeStart}
        rangeEnd={checkinPagination.rangeEnd}
        onChange={checkinPagination.setPage}
      />
    </>
  );
}
