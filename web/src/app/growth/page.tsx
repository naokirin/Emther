"use client";

import { useState } from "react";
import styles from "@/app/page.module.css";
import { PaginationControls, usePagination } from "@/components/Pagination";
import { EmCheckinForm, EmCheckinHistory, useEmCheckinController } from "@/components/EmCheckinWidget";
import { CheckinTrendChart, PeriodNavigator, usePeriodNavigator } from "@/components/DailyTrendChart";
import { PageTitleRow } from "@/components/HelpLink";
import { GrowSuggestionsPanel } from "@/components/growth/GrowSuggestionsPanel";
import { ReflectionNoteForm, useReflectionNoteController } from "@/components/growth/ReflectionNoteForm";
import { buildCheckinDailyTrend } from "@/lib/daily-trends";
import type { EmReflectionNote, ReflectionNoteType } from "@/lib/types";

const WEEK_GROUP_PAGE_SIZE = 4;
const DAY_MS = 24 * 60 * 60 * 1000;

const NOTE_TYPE_SHORT: Record<ReflectionNoteType, string> = {
  keep: "Keep",
  problem: "Problem",
  try: "Try",
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
  const noteController = useReflectionNoteController();
  const { notes, setNotes, notesLoaded } = noteController;
  const checkin = useEmCheckinController();
  const checkinNav = usePeriodNavigator("week");
  const checkinTrend = buildCheckinDailyTrend(checkin.checkins, checkinNav.window);

  // ユーザー要望「現在の改善方針が残り続けてコントロールできない」対応。
  const [policyUpdating, setPolicyUpdating] = useState(false);
  const [policyError, setPolicyError] = useState<string | null>(null);
  // 完了／アーカイブ済みは既定で閉じ、必要なときだけ開く（学びの提案の「見送る」と同型）。
  const [showArchivedPolicies, setShowArchivedPolicies] = useState(false);

  // archivedAt付きのTryは「現在の改善方針」から外す（週次KPTの履歴には残る）。
  const latestTryNote = notes.find((n) => n.type === "try" && !n.archivedAt);
  const archivedTryNotes = notes
    .filter((n) => n.type === "try" && n.archivedAt)
    .sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0));
  const weekGroups = groupNotesByWeek(notes);
  const weekGroupPagination = usePagination(weekGroups, WEEK_GROUP_PAGE_SIZE);

  // archived=true: 方針パネルから外す／false: 直近の完了を「現在の改善方針」へ戻す。
  async function handleSetPolicyArchived(noteId: string, archived: boolean) {
    setPolicyUpdating(true);
    setPolicyError(null);
    try {
      const res = await fetch(`/api/em-self/reflection-notes/${noteId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.note) {
        throw new Error(data?.error ?? (archived ? "完了／アーカイブに失敗しました" : "戻すのに失敗しました"));
      }
      setNotes(notes.map((n) => (n.id === data.note.id ? data.note : n)));
    } catch (err) {
      setPolicyError((err as Error).message);
    } finally {
      setPolicyUpdating(false);
    }
  }

  return (
    <div className={styles.screen}>
      <PageTitleRow title="EMの成長" helpAnchor="reflection" />

      <GrowSuggestionsPanel />

      <div className={styles.panel}>
        <h2>現在の改善方針</h2>
        {latestTryNote ? (
          <>
            <p style={{ fontSize: "0.875rem", fontWeight: 600, margin: "4px 0" }}>{latestTryNote.text}</p>
            <p className={styles.subtitle}>{formatDate(latestTryNote.createdAt)}のTryメモより</p>
            <div className={styles.yieldActions} style={{ marginTop: 8 }}>
              <button
                type="button"
                className={styles.btnOutline}
                disabled={policyUpdating}
                onClick={() => handleSetPolicyArchived(latestTryNote.id, true)}
              >
                {policyUpdating ? "処理中…" : "完了 / アーカイブする"}
              </button>
            </div>
          </>
        ) : (
          <p className={styles.subtitle}>
            {!notesLoaded
              ? "読み込み中…"
              : notes.some((n) => n.type === "try")
                ? "いまフォーカス中の改善方針はありません。新しいTryメモを書くと、ここに表示されます。"
                : "まだTryメモが記録されていません。気づいた時に下のフォームからメモしておきましょう。"}
          </p>
        )}
        {archivedTryNotes.length > 0 && (
          <>
            <button
              type="button"
              className={`${styles.detailToggle} ${styles.detailToggleButton}`}
              style={{ marginTop: 12 }}
              onClick={() => setShowArchivedPolicies(!showArchivedPolicies)}
            >
              {showArchivedPolicies
                ? "完了 / アーカイブ済みを隠す"
                : `完了 / アーカイブ済みを見る（${archivedTryNotes.length}）`}
            </button>
            {showArchivedPolicies &&
              archivedTryNotes.map((n) => (
                <div
                  key={n.id}
                  style={{
                    marginTop: 10,
                    paddingTop: 10,
                    borderTop: "1px solid var(--border)",
                    opacity: 0.85,
                  }}
                >
                  <p style={{ fontSize: "0.875rem", fontWeight: 600, margin: "0 0 4px" }}>{n.text}</p>
                  <p className={styles.subtitle} style={{ margin: 0 }}>
                    {formatDate(n.createdAt)}のTryメモ
                    {n.archivedAt ? ` · ${formatDate(n.archivedAt)}に完了` : ""}
                  </p>
                  <div className={styles.yieldActions} style={{ marginTop: 6 }}>
                    <button
                      type="button"
                      className={styles.btnOutline}
                      disabled={policyUpdating}
                      onClick={() => handleSetPolicyArchived(n.id, false)}
                    >
                      {policyUpdating ? "処理中…" : "戻す"}
                    </button>
                  </div>
                </div>
              ))}
          </>
        )}
        {policyError && (
          <p className={styles.errorText} role="alert">
            {policyError}
          </p>
        )}
      </div>

      <div className={styles.dashColumns}>
        <div className={styles.panel}>
          <h2>EM自身のバイタル（自己チェックイン）</h2>
          <EmCheckinForm controller={checkin} />
        </div>

        <div className={styles.panel}>
          <h2>振り返り（Keep / Problem / Try）</h2>
          <ReflectionNoteForm controller={noteController} />
        </div>
      </div>

      <div className={styles.panel}>
        <h2>チェックインの推移（日次）</h2>
        <div style={{ marginBottom: 10 }}>
          <PeriodNavigator state={checkinNav} />
        </div>
        <CheckinTrendChart points={checkinTrend} />
      </div>

      <div className={styles.panel}>
        <h2>チェックイン履歴</h2>
        <EmCheckinHistory controller={checkin} />
      </div>

      <div className={styles.panel}>
        <h2>週次のKPT</h2>
        {weekGroups.length === 0 ? (
          <p className={styles.subtitle}>
            {!notesLoaded ? "読み込み中…" : "まだ気づきメモがありません。"}
          </p>
        ) : (
          <div className={styles.tableWrap} style={{ marginTop: 0 }}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>週</th>
                  <th>{NOTE_TYPE_SHORT.keep}</th>
                  <th>{NOTE_TYPE_SHORT.problem}</th>
                  <th>{NOTE_TYPE_SHORT.try}</th>
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
  );
}
