"use client";

import { useState } from "react";
import styles from "@/app/page.module.css";
import { Modal } from "@/components/Modal";
import { Select } from "@/components/Select";
import type { AgentRun } from "@/components/RunDetail";
import {
  INTERVENTION_TYPES,
  type ObjectiveWithProgress,
  type OrgTheme,
  type Team,
} from "@/lib/types";

type Props = {
  open: boolean;
  onClose: () => void;
  runs: AgentRun[];
  teams: Team[];
  themes: OrgTheme[];
  objectives: ObjectiveWithProgress[];
  onCreated: (issueId: string) => void;
};

// 「＋ 新しいIssue」ダイアログ。open=falseの間もこのコンポーネント自体はマウントされたままにし、
// 入力中の内容がダイアログの開閉をまたいで保持される元の挙動（フォームstateがページ側に
// あったため閉じても消えなかった）を保つ。
export function IssueCreateDialog({ open, onClose, runs, teams, themes, objectives, onCreated }: Props) {
  const [issueTitle, setIssueTitle] = useState("");
  const [issueRunId, setIssueRunId] = useState("");
  const [issueWhy, setIssueWhy] = useState("");
  const [issueWhat, setIssueWhat] = useState("");
  const [issueHow, setIssueHow] = useState("");
  const [issueTags, setIssueTags] = useState("");
  const [issueKeyResultId, setIssueKeyResultId] = useState("");
  const [issueThemeId, setIssueThemeId] = useState("");
  const [issueTeamId, setIssueTeamId] = useState("");
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [issueSubmitting, setIssueSubmitting] = useState(false);
  const [issueError, setIssueError] = useState<string | null>(null);

  // docs/memo.md「G. Issueに『介入の型』を足す」対応。型は既存tagsへそのまま追加/削除するだけで、
  // 新規フィールドは持たない。最後に選んだ型のwhy/what/howをプレースホルダーとして見せる
  // （実際に入力された値は上書きしない）。
  function toggleInterventionType(label: string) {
    setSelectedTypes((prev) => (prev.includes(label) ? prev.filter((t) => t !== label) : [...prev, label]));
    const current = issueTags.split(",").map((t) => t.trim()).filter(Boolean);
    const next = current.includes(label) ? current.filter((t) => t !== label) : [...current, label];
    setIssueTags(next.join(", "));
  }
  const activeType =
    selectedTypes.length > 0 ? INTERVENTION_TYPES.find((t) => t.label === selectedTypes[selectedTypes.length - 1]) : undefined;

  async function handleCreateIssue(e: React.FormEvent) {
    e.preventDefault();
    if (!issueTitle.trim()) return;
    setIssueSubmitting(true);
    setIssueError(null);
    try {
      const res = await fetch("/api/issues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: issueTitle,
          agentRunId: issueRunId || undefined,
          why: issueWhy,
          what: issueWhat,
          how: issueHow,
          tags: issueTags.split(",").map((t) => t.trim()).filter(Boolean),
          keyResultId: issueKeyResultId || undefined,
          themeId: issueThemeId || undefined,
          teamId: issueTeamId || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Issueの起票に失敗しました");
      setIssueTitle("");
      setIssueRunId("");
      setIssueWhy("");
      setIssueWhat("");
      setIssueHow("");
      setIssueTags("");
      setIssueKeyResultId("");
      setIssueThemeId("");
      setIssueTeamId("");
      setSelectedTypes([]);
      onClose();
      onCreated(data.issue.id);
    } catch (err) {
      setIssueError((err as Error).message);
    } finally {
      setIssueSubmitting(false);
    }
  }

  if (!open) return null;

  return (
    <Modal title="新しいIssueを起票" size="wide" onClose={onClose}>
      <form onSubmit={handleCreateIssue}>
        <div className={styles.field}>
          <label>タイトル
          <input
            type="text"
            autoFocus
            value={issueTitle}
            onChange={(e) => setIssueTitle(e.target.value)}
            placeholder="例: Aさんのリファクタリング停滞"
          /></label>
        </div>
        <div className={styles.field}>
          <label>関連づけるAgent Run（任意）
          <Select
            value={issueRunId}
            onChange={setIssueRunId}
            options={[
              { value: "", label: "なし" },
              ...runs.map((r) => ({ value: r.id, label: `[${r.agentName}] ${r.task.slice(0, 30)}` })),
            ]}
            style={{ display: "block", width: "100%" }}
          /></label>
        </div>

        <div className={styles.field}>
          <label>関連チーム（任意。そのチームのMission/制約を前提として注入する）
          <Select
            value={issueTeamId}
            onChange={setIssueTeamId}
            options={[
              { value: "", label: "なし" },
              ...teams.filter((t) => !t.archived).map((t) => ({ value: t.id, label: t.name })),
            ]}
            style={{ display: "block", width: "100%" }}
          /></label>
        </div>

        <div className={styles.field}>
          <label>紐付けるテーマ（任意。今期の焦点に効く介入か）
          <Select
            value={issueThemeId}
            onChange={setIssueThemeId}
            options={[
              { value: "", label: "なし" },
              ...themes.filter((t) => t.status === "adopted").map((t) => ({ value: t.id, label: t.title })),
            ]}
            style={{ display: "block", width: "100%" }}
          /></label>
        </div>

        <div className={styles.field}>
          <label>紐付けるKey Result（任意。「今期何を解いているか」の一本線を作る）
          <Select
            value={issueKeyResultId}
            onChange={setIssueKeyResultId}
            options={[
              { value: "", label: "なし" },
              ...objectives.flatMap((o) => o.keyResults.map((kr) => ({ value: kr.id, label: `${o.title} ＞ ${kr.title}` }))),
            ]}
            style={{ display: "block", width: "100%" }}
          /></label>
        </div>

        <div className={styles.field}>
          <span className={styles.fieldCaption}>介入の型（任意・複数可。実装タスクではなく仕組み・人・組織への介入の切り口）</span>
          <div
            role="group"
            aria-label="介入の型（複数選択可）"
            style={{ display: "flex", flexWrap: "wrap", gap: 6 }}
          >
            {INTERVENTION_TYPES.map((t) => (
              <button
                key={t.label}
                type="button"
                className={`${styles.typeChip} ${selectedTypes.includes(t.label) ? styles.typeChipSelected : ""}`}
                onClick={() => toggleInterventionType(t.label)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <p className={styles.subtitle} style={{ margin: "8px 0" }}>
          Why/What/Howは分かっている範囲でOK。分からなければ空欄のまま起票し、詳細画面で明らかにしてから計画・実行してください。
        </p>
        <div className={styles.field}>
          <label>Why（このIssueが生む価値・誰のためか・なぜ今か）
          <textarea
            rows={2}
            value={issueWhy}
            onChange={(e) => setIssueWhy(e.target.value)}
            placeholder={activeType?.why ?? "例: Aさんの離脱リスクを下げ、システム基盤の開発速度を維持するため。今対応しないと来期のリリースに響く。"}
          /></label>
        </div>
        <div className={styles.field}>
          <label>What（何を・どこまで・どのくらい・完了の定義）
          <textarea
            rows={2}
            value={issueWhat}
            onChange={(e) => setIssueWhat(e.target.value)}
            placeholder={activeType?.what ?? "例: Bチームからの割り込みタスクを整理し、Aさんが週3日以上リファクタリングに専念できる状態にする。完了条件: ○○。"}
          /></label>
        </div>
        <div className={styles.field}>
          <label>How（どのように実現するか・前提や制約）
          <textarea
            rows={2}
            value={issueHow}
            onChange={(e) => setIssueHow(e.target.value)}
            placeholder={activeType?.how ?? "例: 割り込みタスクの受け入れ基準を定めてBチームと合意する。予算・人員の追加は無い前提。"}
          /></label>
        </div>
        <div className={styles.field}>
          <label>タグ（カンマ区切り、任意）
          <input
            type="text"
            value={issueTags}
            onChange={(e) => setIssueTags(e.target.value)}
            placeholder="例: バグ, リファクタリング, オンボーディング"
          /></label>
        </div>

        {issueError && <p className={styles.errorText} role="alert">{issueError}</p>}
        <button className={styles.primaryBtn} type="submit" disabled={issueSubmitting || !issueTitle.trim()}>
          Issueを起票
        </button>
      </form>
    </Modal>
  );
}
