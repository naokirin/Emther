"use client";

import { useState } from "react";
import styles from "@/app/page.module.css";
import { useTeams } from "@/lib/hooks";

export default function OrgContextPage() {
  const { teams, refreshTeams } = useTeams();

  const [teamName, setTeamName] = useState("");
  const [teamMembers, setTeamMembers] = useState("");
  const [teamSubmitting, setTeamSubmitting] = useState(false);
  const [teamError, setTeamError] = useState<string | null>(null);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);

  const selectedTeam = teams.find((t) => t.id === selectedTeamId) ?? null;

  async function handleAddTeam(e: React.FormEvent) {
    e.preventDefault();
    if (!teamName.trim()) return;
    setTeamSubmitting(true);
    setTeamError(null);
    try {
      const members = teamMembers
        .split(",")
        .map((m) => m.trim())
        .filter(Boolean);
      const res = await fetch("/api/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: teamName, members }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "チームの追加に失敗しました");
      setTeamName("");
      setTeamMembers("");
      setSelectedTeamId(data.team.id);
      await refreshTeams();
    } catch (err) {
      setTeamError((err as Error).message);
    } finally {
      setTeamSubmitting(false);
    }
  }

  async function handleRemoveTeam(id: string) {
    try {
      await fetch(`/api/teams/${id}`, { method: "DELETE" });
      if (selectedTeamId === id) setSelectedTeamId(null);
      await refreshTeams();
    } catch {
      // 失敗時は次回のポーリングで状態が揃う
    }
  }

  return (
    <div className={`${styles.layout} ${styles.screen}`}>
      <div className={styles.panel}>
        <h2>Context Directory</h2>
        <p className={styles.subtitle}>チーム構成はAgent Runtimeへ絶対の前提として注入され、Team Vitalsの算出にも使われます。</p>
        <form onSubmit={handleAddTeam} style={{ marginTop: 10 }}>
          <div className={styles.field}>
            <label>チーム名</label>
            <input type="text" value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder="例: Team A" />
          </div>
          <div className={styles.field}>
            <label>メンバー（カンマ区切り）</label>
            <input
              type="text"
              value={teamMembers}
              onChange={(e) => setTeamMembers(e.target.value)}
              placeholder="例: Aさん, Bさん ※Journalのpeopleと同じ表記で"
            />
          </div>
          <button className={styles.primaryBtn} type="submit" disabled={teamSubmitting || !teamName.trim()}>
            追加
          </button>
        </form>
        {teamError && <p className={styles.errorText}>{teamError}</p>}

        <div className={styles.tree} style={{ marginTop: 14 }}>
          <div className={styles.treeFolder}>📁 Teams（組織体制）</div>
          {teams.length === 0 && <p className={styles.subtitle}>まだチームが登録されていません。</p>}
          {teams.map((t) => (
            <div
              key={t.id}
              className={`${styles.treeFile} ${t.id === selectedTeamId ? styles.treeFileSelected : ""}`}
              onClick={() => setSelectedTeamId(t.id)}
            >
              📁 {t.name}（{t.members.length}名）
            </div>
          ))}
        </div>
      </div>

      <div className={styles.panel}>
        {!selectedTeam && <p className={styles.emptyState}>左のツリーからチームを選択してください。</p>}
        {selectedTeam && (
          <>
            <div className={styles.editorPath}>
              <code>/Teams/{selectedTeam.name}</code>
              <button className={styles.btnOutline} onClick={() => handleRemoveTeam(selectedTeam.id)}>
                このチームを削除
              </button>
            </div>
            <div className={styles.field}>
              <label>Mission</label>
              <textarea rows={2} readOnly value="（未設定。将来のOrganization Context拡張で編集可能にする想定）" />
            </div>
            <div className={styles.field}>
              <label>Members_Profile</label>
              <div className={styles.tagRow} style={{ marginTop: 6 }}>
                {selectedTeam.members.length === 0 && <span className={styles.subtitle}>メンバー未登録</span>}
                {selectedTeam.members.map((m) => (
                  <span key={m} className={`${styles.tag} ${styles.tagPerson}`}>
                    @{m}
                  </span>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
