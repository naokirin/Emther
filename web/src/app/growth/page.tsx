"use client";

import { useState } from "react";
import styles from "@/app/page.module.css";
import { PaginationControls, usePagination } from "@/components/Pagination";
import { EmCheckinWidget } from "@/components/EmCheckinWidget";
import { useReflectionNotes } from "@/lib/hooks";
import type { EmReflectionNote, ReflectionNoteType } from "@/lib/types";

const WEEK_GROUP_PAGE_SIZE = 4;
const DAY_MS = 24 * 60 * 60 * 1000;

const NOTE_TYPE_LABEL: Record<ReflectionNoteType, string> = {
  keep: "👍 Keep（続けたいこと）",
  problem: "⚠️ Problem（気になること）",
  try: "🔧 Try（次にやってみたいこと）",
};

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
  const { notes, setNotes, notesLoaded } = useReflectionNotes();

  const [noteType, setNoteType] = useState<ReflectionNoteType>("keep");
  const [noteText, setNoteText] = useState("");
  const [noteSubmitting, setNoteSubmitting] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);

  const latestTryNote = notes.find((n) => n.type === "try");
  const weekGroups = groupNotesByWeek(notes);
  const weekGroupPagination = usePagination(weekGroups, WEEK_GROUP_PAGE_SIZE);

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
          <p className={styles.subtitle}>
            {!notesLoaded ? "読み込み中…" : "まだTryメモが記録されていません。気づいた時に下のフォームからメモしておきましょう。"}
          </p>
        )}
      </div>

      <div className={styles.dashColumns}>
        <div className={styles.panel}>
          <h2>EM自身のバイタル（自己チェックイン）</h2>
          <p className={styles.subtitle} style={{ marginBottom: 10 }}>
            チームの状態と同じく、EM自身のコンディションも記録しなければ見えなくなります。気分・エネルギー・ストレスを自己申告で記録します（他者からの推測ではなく、あなた自身の申告そのものが根拠です）。
          </p>
          <EmCheckinWidget />
        </div>

        <div className={styles.panel}>
          <h2>振り返り（Keep / Problem / Try）</h2>
          <p className={styles.subtitle} style={{ marginBottom: 10 }}>
            思いついた時にひとことメモしておけば、週ごとに自動でまとまります。「今週の振り返り」をまとめて書く必要はありません。
          </p>
          <form onSubmit={handleNoteSubmit}>
            <div className={styles.field}>
              {/* 改修依頼「selectの選択肢の選択のしにくさそのものの改善」対応。固定3択は
                  プルダウンで隠さずボタン群にする。 */}
              <span className={styles.fieldCaption}>種類</span>
              <div role="group" aria-label="種類" style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {(["keep", "problem", "try"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={`${styles.typeChip} ${noteType === t ? styles.typeChipSelected : ""}`}
                    onClick={() => setNoteType(t)}
                  >
                    {NOTE_TYPE_LABEL[t]}
                  </button>
                ))}
              </div>
            </div>
            <div className={styles.journalInputRow}>
              <textarea
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                rows={3}
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

          {weekGroups.length === 0 ? (
            <p className={styles.subtitle} style={{ marginTop: 12 }}>
              {!notesLoaded ? "読み込み中…" : "まだ気づきメモがありません。"}
            </p>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>週</th>
                    <th>{NOTE_TYPE_LABEL.keep}</th>
                    <th>{NOTE_TYPE_LABEL.problem}</th>
                    <th>{NOTE_TYPE_LABEL.try}</th>
                  </tr>
                </thead>
                <tbody>
                  {weekGroupPagination.pageItems.map((g) => (
                    <tr key={g.weekStart}>
                      <td className={styles.tableMuted} style={{ whiteSpace: "nowrap" }}>
                        {formatDate(g.weekStart)} 〜 {formatDate(g.weekEnd)}
                      </td>
                      {(["keep", "problem", "try"] as const).map((type) => (
                        <td key={type}>
                          {g.notesByType[type].length > 0 && (
                            <ul style={{ margin: 0, paddingLeft: 16 }}>
                              {g.notesByType[type].map((n) => (
                                <li key={n.id}>{n.text}</li>
                              ))}
                            </ul>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
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
