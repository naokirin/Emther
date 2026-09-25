import { useState } from "react";
import styles from "../../styles/page.module.css";
import { api } from "../../lib/api-client";
import type { Team } from "@emther/core/types";
import type { TeamMutationResponse, TeamsBulkMutationResponse } from "@emther/api-contract";

export function TeamCreatePanel({
  refreshTeams,
  onCreated,
}: {
  refreshTeams: () => Promise<void>;
  onCreated: (team: Team) => void;
}) {
  const [teamName, setTeamName] = useState("");
  const [teamMembers, setTeamMembers] = useState("");
  const [teamSubmitting, setTeamSubmitting] = useState(false);
  const [teamError, setTeamError] = useState<string | null>(null);
  const [bulkText, setBulkText] = useState("");
  const [bulkSubmitting, setBulkSubmitting] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkResult, setBulkResult] = useState<{ created: number; skipped: string[] } | null>(null);

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
      const res = await api.api.teams.$post({
        json: { name: teamName, members },
      });
      const data = (await res.json()) as TeamMutationResponse & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "チームの追加に失敗しました");
      setTeamName("");
      setTeamMembers("");
      onCreated(data.team!);
      await refreshTeams();
    } catch (err) {
      setTeamError((err as Error).message);
    } finally {
      setTeamSubmitting(false);
    }
  }

  async function handleBulkAddTeams(e: React.FormEvent) {
    e.preventDefault();
    if (!bulkText.trim()) return;
    setBulkSubmitting(true);
    setBulkError(null);
    setBulkResult(null);
    try {
      const res = await api.api.teams.bulk.$post({
        json: { text: bulkText },
      });
      const data = (await res.json()) as TeamsBulkMutationResponse & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "一括登録に失敗しました");
      setBulkText("");
      setBulkResult({ created: data.teams!.length, skipped: data.skipped! });
      await refreshTeams();
    } catch (err) {
      setBulkError((err as Error).message);
    } finally {
      setBulkSubmitting(false);
    }
  }

  return (
    <>
      <form onSubmit={handleAddTeam} style={{ marginTop: 10 }}>
        <div className={styles.field}>
          <label>チーム名
          <input type="text" value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder="例: Engineering / Team A" /></label>
          <p className={styles.subtitle} style={{ margin: "4px 0 0" }}>
            「親 / 子」のように <code>/</code> で階層化できます。左のツリーに反映されます。
          </p>
        </div>
        <div className={styles.field}>
          <label>メンバー（カンマ区切り）
          <input
            type="text"
            value={teamMembers}
            onChange={(e) => setTeamMembers(e.target.value)}
            placeholder="例: Aさん, Bさん"
          /></label>
        </div>
        <button className={styles.primaryBtn} type="submit" disabled={teamSubmitting || !teamName.trim()}>
          追加
        </button>
      </form>
      {teamError && <p className={styles.errorText} role="alert">{teamError}</p>}

      <details style={{ marginTop: 10 }}>
        <summary style={{ cursor: "pointer", fontSize: "0.875rem" }}>複数チームを一括登録（初回投入用）</summary>
        <form onSubmit={handleBulkAddTeams} style={{ marginTop: 8 }}>
          <div className={styles.field}>
            <label>1行1チーム、「チーム名: メンバー1, メンバー2」の形式で貼り付け
            <textarea
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
              rows={5}
              placeholder={"例:\nEngineering / Team A: Aさん, Bさん\nEngineering / Team B: Cさん\nDesign: Dさん, Eさん"}
              style={{ width: "100%", fontFamily: "inherit", fontSize: "0.875rem" }}
            /></label>
            <p className={styles.subtitle} style={{ margin: "4px 0 0" }}>
              チーム名に <code>/</code> を入れると階層になります（例: Engineering / Team A）。
            </p>
          </div>
          <button className={styles.primaryBtn} type="submit" disabled={bulkSubmitting || !bulkText.trim()}>
            {bulkSubmitting ? "登録中…" : "一括登録"}
          </button>
        </form>
        {bulkError && <p className={styles.errorText} role="alert">{bulkError}</p>}
        {bulkResult && (
          <p className={styles.subtitle} style={{ marginTop: 6 }}>
            {bulkResult.created}件のチームを作成しました。
            {bulkResult.skipped.length > 0 && `（形式不正で${bulkResult.skipped.length}行をスキップ: ${bulkResult.skipped.join(" / ")}）`}
          </p>
        )}
      </details>
    </>
  );
}
