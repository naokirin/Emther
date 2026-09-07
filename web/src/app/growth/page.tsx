"use client";

import { useState } from "react";
import styles from "@/app/page.module.css";
import { PaginationControls, usePagination } from "@/components/Pagination";
import { useEmCheckins, useReflectionNotes } from "@/lib/hooks";
import type { EmReflectionNote, ReflectionNoteType } from "@/lib/types";

const SCALE_OPTIONS = [1, 2, 3, 4, 5];
const CHECKIN_PAGE_SIZE = 10;
const WEEK_GROUP_PAGE_SIZE = 4;
const DAY_MS = 24 * 60 * 60 * 1000;

const NOTE_TYPE_LABEL: Record<ReflectionNoteType, string> = {
  keep: "👍 Keep（続けたいこと）",
  problem: "⚠️ Problem（気になること）",
  try: "🔧 Try（次にやってみたいこと）",
};

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric" });
}

// 改修依頼「週次振り返りを『思いついたときに書き込み、レポートの週次で振り返る』
// 仕組みに」対応。週の起点を月曜0時にそろえ、その週に書かれたメモをまとめて1つの
// グループとして表示する（週次で「ガッツリ書く」のではなく、後から眺めるための集計軸）。
function startOfWeek(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diffToMonday);
  return d.getTime();
}

type WeekGroup = {
  weekStart: number;
  weekEnd: number;
  notesByType: Record<ReflectionNoteType, EmReflectionNote[]>;
};

function groupNotesByWeek(notes: EmReflectionNote[]): WeekGroup[] {
  const groups = new Map<number, WeekGroup>();
  for (const note of notes) {
    const weekStart = startOfWeek(note.createdAt);
    let group = groups.get(weekStart);
    if (!group) {
      group = { weekStart, weekEnd: weekStart + 6 * DAY_MS, notesByType: { keep: [], problem: [], try: [] } };
      groups.set(weekStart, group);
    }
    group.notesByType[note.type].push(note);
  }
  return [...groups.values()].sort((a, b) => b.weekStart - a.weekStart);
}

// docs/memo.md TODO「人間EM自体の成長に対する向き合いを作る。EM本人のバイタル、週次振り返りの
// 入力・改善方針機能を作る」対応。Team Vitalsは「感覚」で埋めず観測から機械的に算出する方針だが、
// これはEM自身についての自己申告であり、本人の申告そのものが根拠になるため、良好/要注意といった
// アルゴリズム判定は行わず、数値と履歴をそのまま見せる。
export default function GrowthPage() {
  const { checkins, setCheckins } = useEmCheckins();
  const { notes, setNotes } = useReflectionNotes();

  const [mood, setMood] = useState(3);
  const [energy, setEnergy] = useState(3);
  const [stress, setStress] = useState(3);
  const [note, setNote] = useState("");
  const [checkinSubmitting, setCheckinSubmitting] = useState(false);
  const [checkinError, setCheckinError] = useState<string | null>(null);

  const [noteType, setNoteType] = useState<ReflectionNoteType>("keep");
  const [noteText, setNoteText] = useState("");
  const [noteSubmitting, setNoteSubmitting] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);

  const latestTryNote = notes.find((n) => n.type === "try");
  const recentCheckins = checkins.slice(0, 7);
  const avgMood = average(recentCheckins.map((c) => c.mood));
  const avgEnergy = average(recentCheckins.map((c) => c.energy));
  const avgStress = average(recentCheckins.map((c) => c.stress));

  const checkinPagination = usePagination(checkins, CHECKIN_PAGE_SIZE);
  const weekGroups = groupNotesByWeek(notes);
  const weekGroupPagination = usePagination(weekGroups, WEEK_GROUP_PAGE_SIZE);

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

  // 改修依頼対応。1回の送信＝1件のメモ。typeは直前の選択を保ったままにする
  // （同じ種類のメモを立て続けに書きたい場面が多いため、毎回選び直させない）。
  async function handleNoteSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!noteText.trim()) return;
    setNoteSubmitting(true);
    setNoteError(null);
    try {
      const res = await fetch("/api/em-self/reflection-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: noteType, text: noteText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "記録に失敗しました");
      setNotes([data.note, ...notes]);
      setNoteText("");
    } catch (err) {
      setNoteError((err as Error).message);
    } finally {
      setNoteSubmitting(false);
    }
  }

  return (
    <div className={styles.screen}>
      <p className={styles.subtitle} style={{ margin: "-8px 0 12px" }}>
        🗓 チェックインは週次の儀式でOK。毎日は必須ではありません。下の気づきメモはその逆で、思いついたスキマ時間にひとことずつどうぞ。
      </p>
      <div className={styles.panel}>
        <h2>現在の改善方針</h2>
        {latestTryNote ? (
          <>
            <p style={{ fontSize: "0.875rem", fontWeight: 600, margin: "4px 0" }}>{latestTryNote.text}</p>
            <p className={styles.subtitle}>{formatDate(latestTryNote.createdAt)}のTryメモより</p>
          </>
        ) : (
          <p className={styles.subtitle}>まだTryメモが記録されていません。気づいた時に下のフォームからメモしておきましょう。</p>
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
            <button className={styles.primaryBtn} type="submit" disabled={checkinSubmitting}>
              {checkinSubmitting ? "記録中…" : "記録する"}
            </button>
          </form>
          {checkinError && (
            <p className={styles.errorText} role="alert">
              {checkinError}
            </p>
          )}

          {recentCheckins.length > 0 && (
            <p className={styles.subtitle} style={{ marginTop: 10 }}>
              直近{recentCheckins.length}件の平均: 気分 {avgMood?.toFixed(1)} / エネルギー {avgEnergy?.toFixed(1)} / ストレス {avgStress?.toFixed(1)}
            </p>
          )}

          <div className={styles.runList} style={{ marginTop: 12 }}>
            {checkins.length === 0 && <p className={styles.subtitle}>まだ記録がありません。</p>}
            {checkinPagination.pageItems.map((c) => (
              <div key={c.id} className={styles.journalEntry}>
                <div style={{ display: "flex", gap: 10, fontSize: "0.75rem", flexWrap: "wrap" }}>
                  <span>気分 {c.mood}</span>
                  <span>エネルギー {c.energy}</span>
                  <span>ストレス {c.stress}</span>
                  <span className={styles.subtitle}>{formatDate(c.createdAt)}</span>
                </div>
                {c.note && <div style={{ marginTop: 4, fontSize: "0.8125rem" }}>{c.note}</div>}
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
          <h2>振り返り（Keep / Problem / Try）</h2>
          <p className={styles.subtitle} style={{ marginBottom: 10 }}>
            思いついた時にひとことメモしておけば、週ごとに自動でまとまります。「今週の振り返り」をまとめて書く必要はありません。
          </p>
          <form onSubmit={handleNoteSubmit}>
            <div className={styles.field}>
              <label>
                種類
                <select value={noteType} onChange={(e) => setNoteType(e.target.value as ReflectionNoteType)}>
                  <option value="keep">{NOTE_TYPE_LABEL.keep}</option>
                  <option value="problem">{NOTE_TYPE_LABEL.problem}</option>
                  <option value="try">{NOTE_TYPE_LABEL.try}</option>
                </select>
              </label>
            </div>
            <div className={styles.journalInputRow}>
              <input
                type="text"
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="例: 割り込み対応が多くて計画的な仕事に時間を割けなかった"
              />
              <button className={styles.primaryBtn} style={{ width: "auto" }} type="submit" disabled={noteSubmitting || !noteText.trim()}>
                {noteSubmitting ? "記録中…" : "記録する"}
              </button>
            </div>
          </form>
          {noteError && (
            <p className={styles.errorText} role="alert">
              {noteError}
            </p>
          )}

          <div className={styles.runList} style={{ marginTop: 12 }}>
            {weekGroups.length === 0 && <p className={styles.subtitle}>まだ気づきメモがありません。</p>}
            {weekGroupPagination.pageItems.map((g) => (
              <div key={g.weekStart} className={styles.journalEntry}>
                <div className={styles.subtitle}>
                  {formatDate(g.weekStart)} 〜 {formatDate(g.weekEnd)}
                </div>
                {(["keep", "problem", "try"] as const).map(
                  (type) =>
                    g.notesByType[type].length > 0 && (
                      <div key={type} style={{ marginTop: 6 }}>
                        <strong style={{ fontSize: "0.8125rem" }}>{NOTE_TYPE_LABEL[type]}</strong>
                        <ul style={{ margin: "2px 0 0", paddingLeft: 18 }}>
                          {g.notesByType[type].map((n) => (
                            <li key={n.id} style={{ fontSize: "0.8125rem" }}>
                              {n.text}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ),
                )}
              </div>
            ))}
          </div>
          <PaginationControls
            page={weekGroupPagination.page}
            totalPages={weekGroupPagination.totalPages}
            total={weekGroupPagination.total}
            rangeStart={weekGroupPagination.rangeStart}
            rangeEnd={weekGroupPagination.rangeEnd}
            onChange={weekGroupPagination.setPage}
          />
        </div>
      </div>
    </div>
  );
}
