"use client";

import { useState } from "react";
import styles from "@/app/page.module.css";
import { PaginationControls, usePagination } from "@/components/Pagination";
import { useEmCheckins, useEmReflections } from "@/lib/hooks";

const SCALE_OPTIONS = [1, 2, 3, 4, 5];
const CHECKIN_PAGE_SIZE = 10;
const REFLECTION_PAGE_SIZE = 5;

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric" });
}

// docs/memo.md TODO「人間EM自体の成長に対する向き合いを作る。EM本人のバイタル、週次振り返りの
// 入力・改善方針機能を作る」対応。Team Vitalsは「感覚」で埋めず観測から機械的に算出する方針だが、
// これはEM自身についての自己申告であり、本人の申告そのものが根拠になるため、良好/要注意といった
// アルゴリズム判定は行わず、数値と履歴をそのまま見せる。
export default function GrowthPage() {
  const { checkins, setCheckins } = useEmCheckins();
  const { reflections, setReflections } = useEmReflections();

  const [mood, setMood] = useState(3);
  const [energy, setEnergy] = useState(3);
  const [stress, setStress] = useState(3);
  const [note, setNote] = useState("");
  const [checkinSubmitting, setCheckinSubmitting] = useState(false);
  const [checkinError, setCheckinError] = useState<string | null>(null);

  const [keep, setKeep] = useState("");
  const [problem, setProblem] = useState("");
  const [tryNext, setTryNext] = useState("");
  const [reflectionSubmitting, setReflectionSubmitting] = useState(false);
  const [reflectionError, setReflectionError] = useState<string | null>(null);

  const latestReflection = reflections[0];
  const recentCheckins = checkins.slice(0, 7);
  const avgMood = average(recentCheckins.map((c) => c.mood));
  const avgEnergy = average(recentCheckins.map((c) => c.energy));
  const avgStress = average(recentCheckins.map((c) => c.stress));

  const checkinPagination = usePagination(checkins, CHECKIN_PAGE_SIZE);
  const reflectionPagination = usePagination(reflections, REFLECTION_PAGE_SIZE);

  async function handleCheckinSubmit(e: React.FormEvent) {
    e.preventDefault();
    setCheckinSubmitting(true);
    setCheckinError(null);
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
      setCheckinError((err as Error).message);
    } finally {
      setCheckinSubmitting(false);
    }
  }

  async function handleReflectionSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!keep.trim() && !problem.trim() && !tryNext.trim()) return;
    setReflectionSubmitting(true);
    setReflectionError(null);
    try {
      const periodEnd = Date.now();
      const periodStart = periodEnd - 7 * 24 * 60 * 60 * 1000;
      const res = await fetch("/api/em-self/reflections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ periodStart, periodEnd, keep, problem, tryNext }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "記録に失敗しました");
      setReflections([data.reflection, ...reflections]);
      setKeep("");
      setProblem("");
      setTryNext("");
    } catch (err) {
      setReflectionError((err as Error).message);
    } finally {
      setReflectionSubmitting(false);
    }
  }

  return (
    <div className={styles.screen}>
      <div className={styles.panel} style={{ marginBottom: 16 }}>
        <h2>現在の改善方針</h2>
        {latestReflection && latestReflection.tryNext ? (
          <>
            <p style={{ fontSize: 14, fontWeight: 600, margin: "4px 0" }}>{latestReflection.tryNext}</p>
            <p className={styles.subtitle}>
              {formatDate(latestReflection.periodStart)} 〜 {formatDate(latestReflection.periodEnd)} の振り返り（Try）より
            </p>
          </>
        ) : (
          <p className={styles.subtitle}>まだ振り返りが記録されていません。下のフォームから今週の振り返りを記録してみましょう。</p>
        )}
      </div>

      <div className={styles.dashColumns}>
        <div className={styles.panel}>
          <h2>EM自身のバイタル（自己チェックイン）</h2>
          <p className={styles.subtitle} style={{ marginBottom: 10 }}>
            チームの状態と同じく、EM自身のコンディションも記録しなければ見えなくなります。気分・エネルギー・ストレスを自己申告で記録します（他者からの推測ではなく、あなた自身の申告そのものが根拠です）。
          </p>
          <form onSubmit={handleCheckinSubmit}>
            <div className={styles.field}>
              <label>気分（1: 悪い 〜 5: 良い）</label>
              <select value={mood} onChange={(e) => setMood(Number(e.target.value))}>
                {SCALE_OPTIONS.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <div className={styles.field}>
              <label>エネルギー（1: 低い 〜 5: 高い）</label>
              <select value={energy} onChange={(e) => setEnergy(Number(e.target.value))}>
                {SCALE_OPTIONS.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <div className={styles.field}>
              <label>ストレス（1: 低い 〜 5: 高い）</label>
              <select value={stress} onChange={(e) => setStress(Number(e.target.value))}>
                {SCALE_OPTIONS.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <div className={styles.field}>
              <label>メモ（任意）</label>
              <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="例: 大きめの障害対応が続いて疲労気味" />
            </div>
            <button className={styles.primaryBtn} type="submit" disabled={checkinSubmitting}>
              {checkinSubmitting ? "記録中…" : "記録する"}
            </button>
          </form>
          {checkinError && <p className={styles.errorText}>{checkinError}</p>}

          {recentCheckins.length > 0 && (
            <p className={styles.subtitle} style={{ marginTop: 10 }}>
              直近{recentCheckins.length}件の平均: 気分 {avgMood?.toFixed(1)} / エネルギー {avgEnergy?.toFixed(1)} / ストレス {avgStress?.toFixed(1)}
            </p>
          )}

          <div className={styles.runList} style={{ marginTop: 12 }}>
            {checkins.length === 0 && <p className={styles.subtitle}>まだ記録がありません。</p>}
            {checkinPagination.pageItems.map((c) => (
              <div key={c.id} className={styles.journalEntry}>
                <div style={{ display: "flex", gap: 10, fontSize: 12, flexWrap: "wrap" }}>
                  <span>気分 {c.mood}</span>
                  <span>エネルギー {c.energy}</span>
                  <span>ストレス {c.stress}</span>
                  <span className={styles.subtitle}>{formatDate(c.createdAt)}</span>
                </div>
                {c.note && <div style={{ marginTop: 4, fontSize: 13 }}>{c.note}</div>}
              </div>
            ))}
          </div>
          <PaginationControls
            page={checkinPagination.page}
            totalPages={checkinPagination.totalPages}
            total={checkinPagination.total}
            rangeStart={checkinPagination.rangeStart}
            rangeEnd={checkinPagination.rangeEnd}
            onChange={checkinPagination.setPage}
          />
        </div>

        <div className={styles.panel}>
          <h2>週次振り返り（KPT）</h2>
          <p className={styles.subtitle} style={{ marginBottom: 10 }}>
            Keep（続けたいこと）・Problem（課題）・Try（次の改善方針）で振り返りを記録します。直近7日間を対象期間として保存されます。
          </p>
          <form onSubmit={handleReflectionSubmit}>
            <div className={styles.field}>
              <label>Keep（続けたいこと・うまくいったこと）</label>
              <textarea rows={2} value={keep} onChange={(e) => setKeep(e.target.value)} placeholder="例: 週次の1on1を全員分実施できた" />
            </div>
            <div className={styles.field}>
              <label>Problem（課題・気になったこと）</label>
              <textarea
                rows={2}
                value={problem}
                onChange={(e) => setProblem(e.target.value)}
                placeholder="例: 割り込み対応が多く、計画的な仕事に時間を割けなかった"
              />
            </div>
            <div className={styles.field}>
              <label>Try（次の改善方針）</label>
              <textarea
                rows={2}
                value={tryNext}
                onChange={(e) => setTryNext(e.target.value)}
                placeholder="例: 割り込み対応の受付時間を決めて、それ以外は集中時間にする"
              />
            </div>
            <button
              className={styles.primaryBtn}
              type="submit"
              disabled={reflectionSubmitting || (!keep.trim() && !problem.trim() && !tryNext.trim())}
            >
              {reflectionSubmitting ? "記録中…" : "この内容で記録"}
            </button>
          </form>
          {reflectionError && <p className={styles.errorText}>{reflectionError}</p>}

          <div className={styles.runList} style={{ marginTop: 12 }}>
            {reflections.length === 0 && <p className={styles.subtitle}>まだ振り返りがありません。</p>}
            {reflectionPagination.pageItems.map((r) => (
              <div key={r.id} className={styles.journalEntry}>
                <div className={styles.subtitle}>
                  {formatDate(r.periodStart)} 〜 {formatDate(r.periodEnd)}
                </div>
                {r.keep && (
                  <div style={{ marginTop: 4, fontSize: 13 }}>
                    <strong>Keep:</strong> {r.keep}
                  </div>
                )}
                {r.problem && (
                  <div style={{ marginTop: 4, fontSize: 13 }}>
                    <strong>Problem:</strong> {r.problem}
                  </div>
                )}
                {r.tryNext && (
                  <div style={{ marginTop: 4, fontSize: 13 }}>
                    <strong>Try:</strong> {r.tryNext}
                  </div>
                )}
              </div>
            ))}
          </div>
          <PaginationControls
            page={reflectionPagination.page}
            totalPages={reflectionPagination.totalPages}
            total={reflectionPagination.total}
            rangeStart={reflectionPagination.rangeStart}
            rangeEnd={reflectionPagination.rangeEnd}
            onChange={reflectionPagination.setPage}
          />
        </div>
      </div>
    </div>
  );
}
