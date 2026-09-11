"use client";

import { useState } from "react";
import Link from "next/link";
import styles from "@/app/page.module.css";
import { TagInput } from "@/components/TagInput";
import { useEntityHistory, useIssues, useJournal, useTeams } from "@/lib/hooks";
import { URGENCY_LABEL, charterFilledCount, teamPathSegments, type Team } from "@/lib/types";

// ユーザー要望「メンバータブを『チーム・メンバー』とし、コンテンツをグループ内タブでチーム・
// メンバーと切り替えられるようにしてほしい」対応。TopNav.tsxの「members」グループへ
// 2画面目として追加し、AppShellのサブナビ機構（複数画面を持つグループで
// 自動的に出る）にそのまま乗せる。チーム管理のロジック自体はpeople/page.tsxから
// この専用ページへ移設しただけで変更していない。

// docs/memo.md TODO「チームの組織階層を入力できるようにする」への対応。
// チーム名の"/"区切り（例: "Engineering/Team A"）をパスとして解釈し、
// 共通のセグメントを持つチームをネストしたフォルダとして表示するためのツリー構造。
type TeamTreeNode = {
  segment: string;
  team?: Team;
  children: TeamTreeNode[];
};

function buildTeamTree(teams: Team[]): TeamTreeNode[] {
  const root: TeamTreeNode[] = [];
  for (const team of teams) {
    let level = root;
    let node: TeamTreeNode | undefined;
    for (const segment of teamPathSegments(team.name)) {
      node = level.find((n) => n.segment === segment);
      if (!node) {
        node = { segment, children: [] };
        level.push(node);
      }
      level = node.children;
    }
    if (node) node.team = team;
  }
  const sortTree = (nodes: TeamTreeNode[]) => {
    nodes.sort((a, b) => a.segment.localeCompare(b.segment, "ja"));
    for (const n of nodes) sortTree(n.children);
  };
  sortTree(root);
  return root;
}

function TeamTreeView({
  nodes,
  depth,
  selectedTeamId,
  onSelect,
}: {
  nodes: TeamTreeNode[];
  depth: number;
  selectedTeamId: string | null;
  onSelect: (team: Team) => void;
}) {
  return (
    <>
      {nodes.map((node) => (
        <div key={`${depth}-${node.segment}`}>
          {node.team ? (
            <div
              className={`${styles.treeFile} ${selectedTeamId === node.team.id ? styles.treeFileSelected : ""}`}
              style={{ paddingLeft: 20 + depth * 14, opacity: node.team.archived ? 0.6 : 1 }}
              onClick={() => onSelect(node.team!)}
            >
              📁 {node.segment}（{node.team.members.length}名）{node.team.archived && " 🗄"}
            </div>
          ) : (
            <div className={styles.treeFolder} style={{ paddingLeft: depth * 14, marginTop: depth === 0 ? 10 : 2 }}>
              📁 {node.segment}
            </div>
          )}
          {node.children.length > 0 && (
            <TeamTreeView nodes={node.children} depth={depth + 1} selectedTeamId={selectedTeamId} onSelect={onSelect} />
          )}
        </div>
      ))}
    </>
  );
}

export default function TeamsPage() {
  const { teams, teamsLoaded, refreshTeams } = useTeams();
  const { issues } = useIssues();
  const { journalEntries } = useJournal();

  const [teamName, setTeamName] = useState("");
  const [teamMembers, setTeamMembers] = useState("");
  const [teamSubmitting, setTeamSubmitting] = useState(false);
  const [teamError, setTeamError] = useState<string | null>(null);
  const [bulkText, setBulkText] = useState("");
  const [bulkSubmitting, setBulkSubmitting] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkResult, setBulkResult] = useState<{ created: number; skipped: string[] } | null>(null);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [showArchivedTeams, setShowArchivedTeams] = useState(false);

  const selectedTeam = selectedTeamId ? teams.find((t) => t.id === selectedTeamId) ?? null : null;
  const visibleTeams = teams.filter((t) => showArchivedTeams || !t.archived);
  const teamTree = buildTeamTree(visibleTeams);
  const { history: teamHistory } = useEntityHistory("team", selectedTeam?.id ?? null);

  // docs/memo.md TODO「チームや、メンバーごとの関連するIssueおよびIssueではない特性や問題などについて、
  // 確認できるようにする」への対応。Issueは teamId 明示＋メンバー名の本文一致、
  // Journalは方針A（明示 teamIds またはメンバー一致）で関連付ける。
  const relatedIssues = selectedTeam
    ? issues.filter((issue) => {
        if (issue.teamId === selectedTeam.id) return true;
        const haystack = `${issue.title} ${issue.charter.why} ${issue.charter.what} ${issue.charter.how}`;
        return selectedTeam.members.some((m) => haystack.includes(m));
      })
    : [];
  const relatedJournal = selectedTeam
    ? journalEntries
        .filter((e) => (e.teamIds ?? []).includes(selectedTeam.id) || e.people.some((p) => selectedTeam.members.includes(p)))
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 10)
    : [];

  // チーム編集フォームのドラフト。ツリーでチームをクリックした瞬間（selectTeam）にだけ
  // 実データで初期化する（継続的な同期はしない——EM編集中の内容をポーリングが上書きしないため）。
  const [editName, setEditName] = useState("");
  const [editMembers, setEditMembers] = useState("");
  const [editMission, setEditMission] = useState("");
  const [editConstraints, setEditConstraints] = useState("");
  const [editManagedByEm, setEditManagedByEm] = useState(true);
  const [editAliases, setEditAliases] = useState<string[]>([]);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [archiving, setArchiving] = useState(false);

  function selectTeam(team: Team) {
    setEditName(team.name);
    setEditMembers(team.members.join(", "));
    setEditMission(team.charter.mission);
    setEditConstraints(team.charter.constraints);
    setEditManagedByEm(team.managedByEm);
    setEditAliases(team.aliases);
    setEditError(null);
    setSelectedTeamId(team.id);
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
      selectTeam(data.team);
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
      const res = await fetch("/api/teams/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: bulkText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "一括登録に失敗しました");
      setBulkText("");
      setBulkResult({ created: data.teams.length, skipped: data.skipped });
      await refreshTeams();
    } catch (err) {
      setBulkError((err as Error).message);
    } finally {
      setBulkSubmitting(false);
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
        <h2>Teams</h2>
        <p className={styles.subtitle}>
          チーム構成はAgent Runtimeへ絶対の前提として注入され、Team Vitalsの算出にも使われます。チーム名に「/」を入れると組織階層を表現できます（例:
          「Engineering / Team A」）。
        </p>
        <form onSubmit={handleAddTeam} style={{ marginTop: 10 }}>
          <div className={styles.field}>
            <label>チーム名
            <input type="text" value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder="例: Engineering / Team A" /></label>
          </div>
          <div className={styles.field}>
            <label>メンバー（カンマ区切り）
            <input
              type="text"
              value={teamMembers}
              onChange={(e) => setTeamMembers(e.target.value)}
              placeholder="例: Aさん, Bさん ※Journalのpeopleと同じ表記で"
            /></label>
          </div>
          <button className={styles.primaryBtn} type="submit" disabled={teamSubmitting || !teamName.trim()}>
            追加
          </button>
        </form>
        {teamError && <p className={styles.errorText} role="alert">{teamError}</p>}

        <details style={{ marginTop: 10 }}>
          <summary style={{ cursor: "pointer", fontSize: "0.8125rem" }}>複数チームを一括登録（初回投入用）</summary>
          <form onSubmit={handleBulkAddTeams} style={{ marginTop: 8 }}>
            <div className={styles.field}>
              <label>1行1チーム、「チーム名: メンバー1, メンバー2」の形式で貼り付け
              <textarea
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
                rows={5}
                placeholder={"例:\nEngineering / Team A: Aさん, Bさん\nEngineering / Team B: Cさん\nDesign: Dさん, Eさん"}
                style={{ width: "100%", fontFamily: "inherit", fontSize: "0.8125rem" }}
              /></label>
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

        <div className={styles.tree} style={{ marginTop: 14 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.75rem", color: "var(--text-muted)", margin: "4px 0" }}>
            <input type="checkbox" checked={showArchivedTeams} onChange={(e) => setShowArchivedTeams(e.target.checked)} />
            アーカイブ済みも表示する
          </label>
          {visibleTeams.length === 0 && (
            <p className={styles.subtitle}>{!teamsLoaded ? "読み込み中…" : "まだチームが登録されていません。"}</p>
          )}
          <TeamTreeView nodes={teamTree} depth={0} selectedTeamId={selectedTeamId} onSelect={selectTeam} />
        </div>
      </div>

      <div className={styles.panel}>
        {!selectedTeam && <p className={styles.emptyState}>左のツリーからチームを選択してください。</p>}

        {selectedTeam && (
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
                🗄 このチームはアーカイブ済みです。Team VitalsおよびAgent Runtimeへの注入対象からは除外されます。
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
                placeholder="例: Aさん, Bさん ※Journalのpeopleと同じ表記で"
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
            <p className={styles.subtitle} style={{ marginBottom: 8 }}>
              このチームに紐付いたIssueのAgent Runにだけ、絶対の前提として注入されます（他チームへは注入されません）。
            </p>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.8125rem", marginBottom: 10 }}>
              <input type="checkbox" checked={editManagedByEm} onChange={(e) => setEditManagedByEm(e.target.checked)} />
              自分が管理するチーム
            </label>
            <p className={styles.subtitle} style={{ marginBottom: 8 }}>
              OFFにすると、このチームのメンバーはPeople一覧で「部下」ではなく「その他」に分類され、1on1
              Coverageの集計対象からも外れます（パートナーチーム・ステークホルダーチームなど、EMが主体的に1on1・Issueを扱わないチーム向け）。他のチームにも所属している場合は、そちらがONであれば「部下」として扱われます。
            </p>
            <div className={styles.field}>
              <span className={styles.fieldCaption}>別名（表記揺れ）</span>
              <TagInput
                values={editAliases}
                onAdd={(v) => setEditAliases((prev) => [...prev, v])}
                onRemove={(v) => setEditAliases((prev) => prev.filter((a) => a !== v))}
                placeholder="略称・旧名など"
                label="別名"
              />
            </div>
            <p className={styles.subtitle} style={{ marginBottom: 8 }}>
              EMの自由記述からどのチームの話かを推定する際（相談・Agent Run起動時）、正式名だけでなくここに登録した別名も一致対象になります。
            </p>
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

            <h3 style={{ marginTop: 20, marginBottom: 4, fontSize: "0.8125rem" }}>関連Issue</h3>
            <p className={styles.subtitle} style={{ marginBottom: 8 }}>
              メンバー名がタイトル・Why/What/Howに含まれるIssueを表示しています（厳密な紐付けではなく名前の一致による簡易抽出です）。
            </p>
            {relatedIssues.length === 0 ? (
              <p className={styles.subtitle}>関連するIssueは見つかりませんでした。</p>
            ) : (
              <div className={styles.tableWrap} style={{ marginBottom: 12 }}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>タイトル</th>
                      <th>Why/What/How</th>
                    </tr>
                  </thead>
                  <tbody>
                    {relatedIssues.map((issue) => (
                      <tr key={issue.id}>
                        <td>
                          <Link href={`/issues/${issue.id}`} className={styles.tableRowLink}>
                            {issue.title}
                          </Link>
                          {issue.archived && <div className={styles.tableMuted}>🗄 アーカイブ済み</div>}
                        </td>
                        <td>
                          <span className={charterFilledCount(issue.charter) === 3 ? styles.charterBadgeReady : styles.charterBadgeWarn}>
                            {charterFilledCount(issue.charter)}/3
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <h3 style={{ marginTop: 20, marginBottom: 4, fontSize: "0.8125rem" }}>関連Journal（Issue化されていない特性・所感）</h3>
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
        )}
      </div>
    </div>
  );
}
