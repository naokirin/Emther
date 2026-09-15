"use client";

import { useState } from "react";
import Link from "next/link";
import styles from "@/app/page.module.css";
import { TagInput } from "@/components/TagInput";
import { SuggestionLink } from "@/components/SuggestionLink";
import { URGENCY_LABEL, suggestionOverviewFromLogs, type Issue, type JournalEntry, type KnowledgeEvent, type Team } from "@/lib/types";

export function TeamEditPanel({
  selectedTeam,
  issues,
  journalEntries,
  teamHistory,
  refreshTeams,
  onRemoved,
}: {
  selectedTeam: Team | null;
  issues: Issue[];
  journalEntries: JournalEntry[];
  teamHistory: KnowledgeEvent[];
  refreshTeams: () => Promise<void>;
  onRemoved: () => void;
}) {
  // チーム編集フォームのドラフト。ツリーでチームをクリックした瞬間（selectedTeam.idの変化）
  // にだけ実データで初期化する（継続的な同期はしない——EM編集中の内容をポーリングが
  // 上書きしないため）。
  const [editName, setEditName] = useState("");
  const [editMembers, setEditMembers] = useState("");
  const [editMission, setEditMission] = useState("");
  const [editConstraints, setEditConstraints] = useState("");
  const [editManagedByEm, setEditManagedByEm] = useState(true);
  const [editAliases, setEditAliases] = useState<string[]>([]);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [archiving, setArchiving] = useState(false);
  const [syncedTeamId, setSyncedTeamId] = useState<string | null>(null);

  if (selectedTeam && selectedTeam.id !== syncedTeamId) {
    setSyncedTeamId(selectedTeam.id);
    setEditName(selectedTeam.name);
    setEditMembers(selectedTeam.members.join(", "));
    setEditMission(selectedTeam.charter.mission);
    setEditConstraints(selectedTeam.charter.constraints);
    setEditManagedByEm(selectedTeam.managedByEm);
    setEditAliases(selectedTeam.aliases);
    setEditError(null);
  }

  // SettingsのisDirtyと同じ。未変更のまま保存できて「保存されたかわからない」状態に
  // ならないよう、サーバー最新値とドラフトを比較する。
  const editMembersNormalized = editMembers
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  const teamDirty =
    !!selectedTeam &&
    (editName !== selectedTeam.name ||
      JSON.stringify(editMembersNormalized) !== JSON.stringify(selectedTeam.members) ||
      editMission !== selectedTeam.charter.mission ||
      editConstraints !== selectedTeam.charter.constraints ||
      editManagedByEm !== selectedTeam.managedByEm ||
      JSON.stringify(editAliases) !== JSON.stringify(selectedTeam.aliases));

  async function handleSaveTeam() {
    if (!selectedTeam || !teamDirty || !editName.trim()) return;
    setEditSaving(true);
    setEditError(null);
    try {
      const members = editMembers.split(",").map((m) => m.trim()).filter(Boolean);
      const res = await fetch(`/api/teams/${selectedTeam.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName,
          members,
          mission: editMission,
          constraints: editConstraints,
          managedByEm: editManagedByEm,
          aliases: editAliases,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "更新に失敗しました");
      await refreshTeams();
    } catch (err) {
      setEditError((err as Error).message);
    } finally {
      setEditSaving(false);
    }
  }

  async function handleToggleTeamArchived() {
    if (!selectedTeam) return;
    setArchiving(true);
    try {
      const res = await fetch(`/api/teams/${selectedTeam.id}/archive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: !selectedTeam.archived }),
      });
      if (res.ok) await refreshTeams();
    } finally {
      setArchiving(false);
    }
  }

  async function handleRemoveTeam(id: string) {
    try {
      await fetch(`/api/teams/${id}`, { method: "DELETE" });
      onRemoved();
      await refreshTeams();
    } catch {
      // 失敗時は次回のポーリングで状態が揃う
    }
  }

  if (!selectedTeam) {
    return <p className={styles.emptyState}>左のツリーからチームを選択してください。</p>;
  }

  // docs/memo.md TODO「チームや、メンバーごとの関連するIssueおよびIssueではない特性や問題などについて、
  // 確認できるようにする」への対応。Issueは teamId 明示＋メンバー名の本文一致、
  // Journalは方針A（明示 teamIds またはメンバー一致）で関連付ける。
  const relatedIssues = issues.filter((issue) => {
    if (issue.teamId === selectedTeam.id) return true;
    const haystack = `${issue.title} ${issue.charter.why} ${issue.charter.what} ${issue.charter.how}`;
    return selectedTeam.members.some((m) => haystack.includes(m));
  });
  const relatedJournal = journalEntries
    .filter((e) => (e.teamIds ?? []).includes(selectedTeam.id) || e.people.some((p) => selectedTeam.members.includes(p)))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 10);

  return (
    <>
      <div className={styles.editorPath}>
        <div style={{ display: "flex", gap: 8 }}>
          <button className={styles.btnOutline} onClick={handleToggleTeamArchived} disabled={archiving}>
            {selectedTeam.archived ? "アーカイブを解除" : "アーカイブする"}
          </button>
          <button className={styles.btnOutline} onClick={() => handleRemoveTeam(selectedTeam.id)}>
            このチームを削除
          </button>
        </div>
      </div>
      {selectedTeam.archived && (
        <p className={styles.subtitle} style={{ marginBottom: 10 }}>
          🗄 アーカイブ済み
        </p>
      )}
      <div className={styles.field}>
        <label>チーム名
        <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} /></label>
      </div>
      <div className={styles.field}>
        <label>メンバー（カンマ区切り）
        <input
          type="text"
          value={editMembers}
          onChange={(e) => setEditMembers(e.target.value)}
          placeholder="例: Aさん, Bさん"
        /></label>
      </div>
      <div className={styles.field}>
        <label>Mission（このチームは何のためにあるか）
        <textarea rows={2} value={editMission} onChange={(e) => setEditMission(e.target.value)} /></label>
      </div>
      <div className={styles.field}>
        <label>制約（意思決定・実行にあたって前提とすべきこと）
        <textarea rows={2} value={editConstraints} onChange={(e) => setEditConstraints(e.target.value)} /></label>
      </div>
      <label
        style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.875rem", marginBottom: 10 }}
        title="OFFにするとメンバーは「その他」になり、1on1 Coverage対象外"
      >
        <input type="checkbox" checked={editManagedByEm} onChange={(e) => setEditManagedByEm(e.target.checked)} />
        自分が管理するチーム
      </label>
      <div className={styles.field}>
        <span className={styles.fieldCaption} title="相談・起動時のチーム推定にも使われます">
          別名（表記揺れ）
        </span>
        <TagInput
          values={editAliases}
          onAdd={(v) => setEditAliases((prev) => [...prev, v])}
          onRemove={(v) => setEditAliases((prev) => prev.filter((a) => a !== v))}
          placeholder="略称・旧名など"
          label="別名"
        />
      </div>
      {editError && <p className={styles.errorText} role="alert">{editError}</p>}
      <button
        className={styles.primaryBtn}
        style={{ width: "auto" }}
        onClick={handleSaveTeam}
        disabled={editSaving || !editName.trim() || !teamDirty}
      >
        {editSaving ? "保存中…" : teamDirty ? "保存" : "保存済み"}
      </button>

      <div className={styles.field} style={{ marginTop: 16 }}>
        <span className={styles.fieldCaption}>Members_Profile（保存済みの状態。クリックで詳細へ）</span>
        <div className={styles.tagRow} style={{ marginTop: 6 }}>
          {selectedTeam.members.length === 0 && <span className={styles.subtitle}>メンバー未登録</span>}
          {selectedTeam.members.map((m) => (
            <Link key={m} href={`/people/${encodeURIComponent(m)}`} className={`${styles.tag} ${styles.tagPerson}`}>
              @{m}
            </Link>
          ))}
        </div>
      </div>

      <h3 style={{ marginTop: 20, marginBottom: 4, fontSize: "0.875rem" }}>関連提案</h3>
      <p className={styles.subtitle} style={{ marginBottom: 8 }}>
        メンバー名がタイトル・メモに含まれる提案を表示しています（厳密な紐付けではなく名前の一致による簡易抽出です）。
      </p>
      {relatedIssues.length === 0 ? (
        <p className={styles.subtitle}>関連する提案は見つかりませんでした。</p>
      ) : (
        <div className={styles.tableWrap} style={{ marginBottom: 12 }}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>タイトル</th>
                <th>メモ</th>
              </tr>
            </thead>
            <tbody>
              {relatedIssues.map((issue) => (
                <tr key={issue.id}>
                  <td>
                    <SuggestionLink id={issue.id} className={styles.tableRowLink}>
                      {issue.title}
                    </SuggestionLink>
                    {issue.archived && <div className={styles.tableMuted}>🗄 確認済み</div>}
                  </td>
                  <td className={styles.tableMuted}>{suggestionOverviewFromLogs(issue.logEntries)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3 style={{ marginTop: 20, marginBottom: 4, fontSize: "0.875rem" }}>関連Journal（提案化されていない特性・所感）</h3>
      <p className={styles.subtitle} style={{ marginBottom: 8 }}>
        このチームに明示紐付けされたJournal、またはメンバーが登場するJournal（直近10件）です。
      </p>
      {relatedJournal.length === 0 ? (
        <p className={styles.subtitle}>関連するJournalは見つかりませんでした。</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>内容</th>
                <th>緊急度 / 感情</th>
                <th>タグ</th>
              </tr>
            </thead>
            <tbody>
              {relatedJournal.map((entry) => (
                <tr key={entry.id}>
                  <td>{entry.rawText}</td>
                  <td className={styles.tableMuted}>
                    {URGENCY_LABEL[entry.urgency]} / {entry.sentiment}
                  </td>
                  <td className={styles.tableMuted}>{entry.tags.join(", ") || "なし"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {teamHistory.length > 0 && (
        <details style={{ marginTop: 20 }}>
          <summary style={{ cursor: "pointer", fontSize: "0.75rem", color: "var(--text-muted)" }}>
            変更履歴（{teamHistory.length}件）
          </summary>
          <ul style={{ listStyle: "none", marginTop: 8 }}>
            {teamHistory.map((h) => (
              <li key={h.id} style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: 4 }}>
                {new Date(h.occurredAt).toLocaleString("ja-JP")} — {h.text}
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
