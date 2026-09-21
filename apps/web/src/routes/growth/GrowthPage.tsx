import { useState } from "react";
import { Link } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import styles from "../../styles/page.module.css";
import { PaginationControls, usePagination } from "../../components/Pagination";
import { PageTitleRow } from "../../components/HelpLink";
import { GrowSuggestionsPanel } from "../../components/growth/GrowSuggestionsPanel";
import { ReflectionNoteForm, useReflectionNoteController } from "../../components/growth/ReflectionNoteForm";
import { reflectionNotesQueryKey } from "../../lib/queries";
import type { EmReflectionNote, ReflectionNoteType } from "@emther/core/types";

// 振り返りタブ改善案: 旧「EMの成長」のうち週次（学び・方針・KPT）だけを残す。
// 自己チェックインは /checkin へ分離。URL /growth と /api/growth/* は維持する。
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

function currentWeekLabel(): string {
  const start = startOfWeek(Date.now());
  const end = start + 6 * DAY_MS;
  const fmt = (ts: number) =>
    new Date(ts).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" });
  return `今週 · ${fmt(start)}–${fmt(end)}`;
}

export function GrowthPage() {
  const noteController = useReflectionNoteController();
  const { notes, notesLoaded } = noteController;
  const queryClient = useQueryClient();

  const [policyUpdating, setPolicyUpdating] = useState(false);
  const [policyError, setPolicyError] = useState<string | null>(null);
  const [showArchivedPolicies, setShowArchivedPolicies] = useState(false);

  const latestTryNote = notes.find((n) => n.type === "try" && !n.archivedAt);
  const archivedTryNotes = notes
    .filter((n) => n.type === "try" && n.archivedAt)
    .sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0));
  const weekGroups = groupNotesByWeek(notes);
  const weekGroupPagination = usePagination(weekGroups, WEEK_GROUP_PAGE_SIZE);

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
      queryClient.setQueryData<{ notes: EmReflectionNote[] }>(reflectionNotesQueryKey, () => ({
        notes: notes.map((n) => (n.id === data.note.id ? data.note : n)),
      }));
    } catch (err) {
      setPolicyError((err as Error).message);
    } finally {
      setPolicyUpdating(false);
    }
  }

  return (
    <div className={styles.screen}>
      <PageTitleRow title="EM週次振り返り" helpAnchor="reflection">
        <span className={styles.subtitle}>{currentWeekLabel()}</span>
      </PageTitleRow>
      <p className={styles.subtitle} style={{ marginTop: -4 }}>
        個人の学びとKPT。組織の全景はレポートへ。この画面で決めるのは「方針」と「学びの取捨」。
      </p>

      <GrowSuggestionsPanel />

      <div className={styles.panel}>
        <p className={styles.subtitle} style={{ margin: 0 }}>
          いまフォーカス中
        </p>
        <h2 style={{ marginTop: 4 }}>現在の改善方針</h2>
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

      <div className={styles.panel}>
        <h2>気づきメモ（Keep / Problem / Try）</h2>
        <p className={styles.subtitle} style={{ marginTop: 0 }}>
          スキマにひとこと。週の表は下でまとまる。
        </p>
        <ReflectionNoteForm controller={noteController} />
      </div>

      <div className={styles.panel}>
        <h2>この数週のKPT</h2>
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

      <div className={styles.panel}>
        <h2>組織の全景はレポートで</h2>
        <p className={styles.subtitle} style={{ marginTop: 0 }}>
          Journal・提案・イベントの週次スナップショットとAIレビューへ
        </p>
        <Link to="/reports" className={styles.primaryBtn} style={{ display: "inline-block", width: "auto" }}>
          レポートを開く →
        </Link>
      </div>
    </div>
  );
}
