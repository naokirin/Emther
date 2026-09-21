import styles from "../styles/page.module.css";
import { PaginationControls } from "./Pagination";
import { RecordDateField } from "./RecordDateField";
import { useEmCheckinController, type EmCheckinController } from "./useEmCheckinController";
import {
  METRIC_LABEL,
  METER_ENDPOINTS,
  SCALE_OPTIONS,
  scaleLabel,
  type CheckinMetricKey,
} from "../lib/checkin-scale";

// web/src/components/EmCheckinWidget.tsx（Next.js版）からの移植（フェーズ3.5
// evening-reviewバッチ）。フェーズ3.2の方針どおり、旧`useEmCheckins`の`setCheckins`
// （楽観的ローカル更新）は`queryClient.setQueryData(emCheckinsQueryKey, ...)`に
// 置き換えた。振り返りタブ改善案で数値チップ→メーター位置、headroom追加。

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric" });
}

function MeterPicker({
  metric,
  value,
  onChange,
}: {
  metric: CheckinMetricKey;
  value: number;
  onChange: (v: number) => void;
}) {
  const label = METRIC_LABEL[metric];
  const ends = METER_ENDPOINTS[metric];
  return (
    <div className={styles.meterCard}>
      <div className={styles.meterCardHead}>
        <span className={styles.meterCardTitle}>{label}</span>
        <span className={styles.meterCardCaption}>{ends.caption}</span>
      </div>
      <div className={styles.meterRow}>
        <span className={styles.meterEndLabel}>{ends.left}</span>
        <div className={styles.meterSliderWrap}>
          <div className={styles.meterTickMarks} aria-hidden="true">
            {SCALE_OPTIONS.map((v) => (
              <span key={v} className={styles.meterTickMark} />
            ))}
          </div>
          <input
            type="range"
            className={styles.meterSlider}
            min={1}
            max={5}
            step={1}
            value={value}
            aria-label={`${label}（${ends.caption}）`}
            onChange={(e) => onChange(Number(e.target.value))}
          />
        </div>
        <span className={styles.meterEndLabel}>{ends.right}</span>
      </div>
    </div>
  );
}

export function EmCheckinForm({ controller }: { controller: EmCheckinController }) {
  const {
    mood,
    setMood,
    energy,
    setEnergy,
    stress,
    setStress,
    headroom,
    setHeadroom,
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
    avgHeadroom,
  } = controller;

  return (
    <>
      <form onSubmit={handleSubmit}>
        <div className={styles.conditionMeterGrid}>
          <MeterPicker metric="mood" value={mood} onChange={setMood} />
          <MeterPicker metric="energy" value={energy} onChange={setEnergy} />
          <MeterPicker metric="stress" value={stress} onChange={setStress} />
          <MeterPicker metric="headroom" value={headroom} onChange={setHeadroom} />
        </div>
        <div className={styles.field}>
          <label>
            メモ（任意）
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="例: 大きめの障害対応が続いて疲労気味"
              rows={3}
            />
          </label>
        </div>
        <div className={styles.checkinFormActions}>
          <button className={styles.primaryBtn} style={{ width: "auto" }} type="submit" disabled={submitting}>
            {submitting ? "記録中…" : "記録する"}
          </button>
          <RecordDateField
            open={dateOpen}
            date={createdAtDate}
            onOpen={openDate}
            onDateChange={setCreatedAtDate}
            onReset={resetDate}
          />
        </div>      </form>
      {error && (
        <p className={styles.errorText} role="alert">
          {error}
        </p>
      )}
      {recentCheckins.length > 0 && (
        <p className={styles.subtitle} style={{ marginTop: 10 }}>
          位置だけ選ぶ。数値ラベルは出さない。直近{recentCheckins.length}件の目安: 気分 {scaleLabel(avgMood)} / エネルギー{" "}
          {scaleLabel(avgEnergy)} / ストレス {scaleLabel(avgStress)} / 余裕 {scaleLabel(avgHeadroom)}
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
                <th className={styles.checkinScaleCol}>エネ</th>
                <th className={styles.checkinScaleCol}>ストレス</th>
                <th className={styles.checkinScaleCol}>余裕</th>
                <th>メモ</th>
              </tr>
            </thead>
            <tbody>
              {checkinPagination.pageItems.map((c) => (
                <tr key={c.id}>
                  <td className={`${styles.tableMuted} ${styles.checkinDateCol}`}>{formatDate(c.createdAt)}</td>
                  <td className={styles.checkinScaleCol}>{scaleLabel(c.mood)}</td>
                  <td className={styles.checkinScaleCol}>{scaleLabel(c.energy)}</td>
                  <td className={styles.checkinScaleCol}>{scaleLabel(c.stress)}</td>
                  <td className={styles.checkinScaleCol}>{scaleLabel(c.headroom)}</td>
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
// 入力・改善方針機能を作る」対応。/checkin の自己チェックインフォーム＋履歴。
export function EmCheckinWidget() {
  const controller = useEmCheckinController();
  return (
    <>
      <EmCheckinForm controller={controller} />
      <EmCheckinHistory controller={controller} />
    </>
  );
}
