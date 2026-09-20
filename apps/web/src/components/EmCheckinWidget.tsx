import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import styles from "../styles/page.module.css";
import { PaginationControls, usePagination } from "./Pagination";
import { RecordDateField, todayDateInputValue } from "./RecordDateField";
import { emCheckinsQueryKey, useEmCheckins } from "../lib/queries";
import type { EmCheckin } from "@emther/core/types";

// web/src/components/EmCheckinWidget.tsx（Next.js版）からの移植（フェーズ3.5
// evening-reviewバッチ）。フェーズ3.2の方針どおり、旧`useEmCheckins`の`setCheckins`
// （楽観的ローカル更新）は`queryClient.setQueryData(emCheckinsQueryKey, ...)`に
// 置き換えた。UIロジック自体は変更していない。
const SCALE_OPTIONS = [1, 2, 3, 4, 5];
const CHECKIN_PAGE_SIZE = 10;

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric" });
}

function ScalePicker({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className={styles.field}>
      <span className={styles.fieldCaption}>{label}</span>
      <div role="group" aria-label={label} className={styles.scalePickerGroup}>
        {SCALE_OPTIONS.map((v) => (
          <button
            key={v}
            type="button"
            className={`${styles.scaleChip} ${value === v ? styles.scaleChipSelected : ""}`}
            onClick={() => onChange(v)}
          >
            {v}
          </button>
        ))}
      </div>
    </div>
  );
}

export type EmCheckinController = ReturnType<typeof useEmCheckinController>;

// /growth では入力と履歴を別パネルに置くため、同じ状態をフォーム／履歴で共有する。
export function useEmCheckinController(onSubmitted?: (checkin: EmCheckin) => void) {
  const { checkins, checkinsLoaded } = useEmCheckins();
  const queryClient = useQueryClient();

  const [mood, setMood] = useState(3);
  const [energy, setEnergy] = useState(3);
  const [stress, setStress] = useState(3);
  const [note, setNote] = useState("");
  const [dateOpen, setDateOpen] = useState(false);
  const [createdAtDate, setCreatedAtDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recentCheckins = checkins.slice(0, 7);
  const avgMood = average(recentCheckins.map((c) => c.mood));
  const avgEnergy = average(recentCheckins.map((c) => c.energy));
  const avgStress = average(recentCheckins.map((c) => c.stress));
  const checkinPagination = usePagination(checkins, CHECKIN_PAGE_SIZE);

  function resetDate() {
    setCreatedAtDate("");
    setDateOpen(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/em-self/checkins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mood,
          energy,
          stress,
          note,
          ...(createdAtDate ? { createdAtDate } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "記録に失敗しました");
      queryClient.setQueryData<{ checkins: EmCheckin[] }>(emCheckinsQueryKey, () => ({
        checkins: [data.checkin, ...checkins],
      }));
      setNote("");
      resetDate();
      onSubmitted?.(data.checkin);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return {
    mood,
    setMood,
    energy,
    setEnergy,
    stress,
    setStress,
    note,
    setNote,
    dateOpen,
    createdAtDate,
    openDate: () => {
      setCreatedAtDate((prev) => prev || todayDateInputValue());
      setDateOpen(true);
    },
    setCreatedAtDate,
    resetDate,
    submitting,
    error,
    handleSubmit,
    recentCheckins,
    avgMood,
    avgEnergy,
    avgStress,
    checkinPagination,
    checkins,
    checkinsLoaded,
  };
}

export function EmCheckinForm({ controller }: { controller: EmCheckinController }) {
  const {
    mood,
    setMood,
    energy,
    setEnergy,
    stress,
    setStress,
    note,
    setNote,
    dateOpen,
    createdAtDate,
    openDate,
    setCreatedAtDate,
    resetDate,
    submitting,
    error,
    handleSubmit,
    recentCheckins,
    avgMood,
    avgEnergy,
    avgStress,
  } = controller;

  return (
    <>
      <form onSubmit={handleSubmit}>
        <ScalePicker label="気分（1: 悪い 〜 5: 良い）" value={mood} onChange={setMood} />
        <ScalePicker label="エネルギー（1: 低い 〜 5: 高い）" value={energy} onChange={setEnergy} />
        <ScalePicker label="ストレス（1: 低い 〜 5: 高い）" value={stress} onChange={setStress} />
        <div className={styles.field}>
          <label>
            メモ（任意）
            <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="例: 大きめの障害対応が続いて疲労気味" />
          </label>
        </div>
        <button className={styles.primaryBtn} type="submit" disabled={submitting}>
          {submitting ? "記録中…" : "記録する"}
        </button>
        <RecordDateField
          open={dateOpen}
          date={createdAtDate}
          onOpen={openDate}
          onDateChange={setCreatedAtDate}
          onReset={resetDate}
        />
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
    </>
  );
}

export function EmCheckinHistory({ controller }: { controller: EmCheckinController }) {
  const { checkins, checkinsLoaded, checkinPagination } = controller;

  return (
    <>
      {checkins.length === 0 ? (
        <p className={styles.subtitle} style={{ marginTop: 12 }}>
          {!checkinsLoaded ? "読み込み中…" : "まだ記録がありません。"}
        </p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>日付</th>
                <th className={styles.checkinScaleCol}>気分</th>
                <th className={styles.checkinScaleCol}>エネルギー</th>
                <th className={styles.checkinScaleCol}>ストレス</th>
                <th>メモ</th>
              </tr>
            </thead>
            <tbody>
              {checkinPagination.pageItems.map((c) => (
                <tr key={c.id}>
                  <td className={`${styles.tableMuted} ${styles.checkinDateCol}`}>{formatDate(c.createdAt)}</td>
                  <td className={styles.checkinScaleCol}>{c.mood}</td>
                  <td className={styles.checkinScaleCol}>{c.energy}</td>
                  <td className={styles.checkinScaleCol}>{c.stress}</td>
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

// docs/memo.md TODO「人間EM自体の成長に対する向き合いを作る。EM本人のバイタル、週次振り返りの
// 入力・改善方針機能を作る」対応。/growthのEM自身のバイタル（自己チェックイン）フォーム＋履歴。
export function EmCheckinWidget() {
  const controller = useEmCheckinController();
  return (
    <>
      <EmCheckinForm controller={controller} />
      <EmCheckinHistory controller={controller} />
    </>
  );
}
