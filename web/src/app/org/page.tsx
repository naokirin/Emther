"use client";

import { useState } from "react";
import Link from "next/link";
import styles from "@/app/page.module.css";
import { useEntityHistory, useIssues, useJournal, useObjectives, useOrgStrategy, useTeams } from "@/lib/hooks";
import { URGENCY_LABEL, charterFilledCount, teamPathSegments, type ObjectiveWithProgress, type OrgStrategy, type Team } from "@/lib/types";

type Selection = { kind: "team"; id: string } | { kind: "strategy" } | { kind: "objective"; id: string } | null;

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
  selection,
  onSelect,
}: {
  nodes: TeamTreeNode[];
  depth: number;
  selection: Selection;
  onSelect: (team: Team) => void;
}) {
  return (
    <>
      {nodes.map((node) => (
        <div key={`${depth}-${node.segment}`}>
          {node.team ? (
            <div
              className={`${styles.treeFile} ${
                selection?.kind === "team" && selection.id === node.team.id ? styles.treeFileSelected : ""
              }`}
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
          {node.children.length > 0 && <TeamTreeView nodes={node.children} depth={depth + 1} selection={selection} onSelect={onSelect} />}
        </div>
      ))}
    </>
  );
}

export default function OrgContextPage() {
  const { teams, refreshTeams } = useTeams();
  const { strategy, refreshStrategy } = useOrgStrategy();
  const { issues } = useIssues();
  const { journalEntries } = useJournal();
  const { objectives, refreshObjectives } = useObjectives();

  const [teamName, setTeamName] = useState("");
  const [teamMembers, setTeamMembers] = useState("");
  const [teamSubmitting, setTeamSubmitting] = useState(false);
  const [teamError, setTeamError] = useState<string | null>(null);
  const [bulkText, setBulkText] = useState("");
  const [bulkSubmitting, setBulkSubmitting] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkResult, setBulkResult] = useState<{ created: number; skipped: string[] } | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const [showArchivedTeams, setShowArchivedTeams] = useState(false);

  const selectedTeam = selection?.kind === "team" ? teams.find((t) => t.id === selection.id) ?? null : null;
  const visibleTeams = teams.filter((t) => showArchivedTeams || !t.archived);
  const teamTree = buildTeamTree(visibleTeams);
  const { history: teamHistory } = useEntityHistory("team", selectedTeam?.id ?? null);

  // docs/memo.md TODO「チームや、メンバーごとの関連するIssueおよびIssueではない特性や問題などについて、
  // Organization Context から確認できるようにする」への対応。Issue-Team間、Journal-Team間の
  // 明示的な紐付けは存在しないため、チームのメンバー名がテキストに含まれるかで簡易的に関連付けている
  // （agent-runtime.tsの各buildXxxContextBlockと同じ、名前の文字列一致という簡略化）。
  // 「Issueではない特性や問題」＝Issue化されていない揺らぎのログとしてJournalエントリを見せる。
  const relatedIssues = selectedTeam
    ? issues.filter((issue) => {
        const haystack = `${issue.title} ${issue.charter.why} ${issue.charter.what} ${issue.charter.how}`;
        return selectedTeam.members.some((m) => haystack.includes(m));
      })
    : [];
  const relatedJournal = selectedTeam
    ? journalEntries
        .filter((e) => e.people.some((p) => selectedTeam.members.includes(p)))
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 10)
    : [];

  // チーム編集フォームのドラフト。ツリーでチームをクリックした瞬間（selectTeam）にだけ
  // 実データで初期化する（Strategyと同じ理由で、継続的な同期は行わない）。
  const [editName, setEditName] = useState("");
  const [editMembers, setEditMembers] = useState("");
  // docs/memo.md「I. チーム単位の憲法（ミッション／制約）」対応。
  const [editMission, setEditMission] = useState("");
  const [editConstraints, setEditConstraints] = useState("");
  // ユーザー要望「部下(自分が管理するチームのメンバー)とそれ以外を分けたい」対応。
  const [editManagedByEm, setEditManagedByEm] = useState(true);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [archiving, setArchiving] = useState(false);

  function selectTeam(team: Team) {
    setEditName(team.name);
    setEditMembers(team.members.join(", "));
    setEditMission(team.charter.mission);
    setEditConstraints(team.charter.constraints);
    setEditManagedByEm(team.managedByEm);
    setEditError(null);
    setSelection({ kind: "team", id: team.id });
  }

  async function handleSaveTeam() {
    if (!selectedTeam) return;
    setEditSaving(true);
    setEditError(null);
    try {
      const members = editMembers.split(",").map((m) => m.trim()).filter(Boolean);
      const res = await fetch(`/api/teams/${selectedTeam.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editName, members, mission: editMission, constraints: editConstraints, managedByEm: editManagedByEm }),
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

  const [strategyDraft, setStrategyDraft] = useState<OrgStrategy>(strategy);
  const [strategySaving, setStrategySaving] = useState(false);

  // ポーリングで取得したstrategyは、Strategyノードをクリックした瞬間にだけ
  // 編集用ドラフトへコピーする（effectで継続的に同期すると、EMが編集中の内容を
  // 次のポーリングが上書きしてしまうため）。
  function selectStrategy() {
    setStrategyDraft(strategy);
    setSelection({ kind: "strategy" });
  }

  async function handleSaveStrategy() {
    setStrategySaving(true);
    try {
      await fetch("/api/org/strategy", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(strategyDraft),
      });
      await refreshStrategy();
    } finally {
      setStrategySaving(false);
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
      if (selection?.kind === "team" && selection.id === id) setSelection(null);
      await refreshTeams();
    } catch {
      // 失敗時は次回のポーリングで状態が揃う
    }
  }

  // docs/memo.md「H. 戦略→Issue→結果の一本線」対応。Objective/KeyResultの管理。
  // Team/Strategyと同じ「ツリーを選んだ瞬間だけドラフトへコピー」方式にする。
  const selectedObjective = selection?.kind === "objective" ? objectives.find((o) => o.id === selection.id) ?? null : null;
  const { history: objectiveHistory } = useEntityHistory("org", selectedObjective?.id ?? null);

  const [newObjectiveTitle, setNewObjectiveTitle] = useState("");
  const [objectiveSubmitting, setObjectiveSubmitting] = useState(false);
  const [objectiveError, setObjectiveError] = useState<string | null>(null);

  const [editObjectiveTitle, setEditObjectiveTitle] = useState("");
  const [objectiveSaving, setObjectiveSaving] = useState(false);
  const [objectiveEditError, setObjectiveEditError] = useState<string | null>(null);
  const [newKeyResultTitle, setNewKeyResultTitle] = useState("");
  const [krSubmitting, setKrSubmitting] = useState(false);

  function selectObjective(o: ObjectiveWithProgress) {
    setEditObjectiveTitle(o.title);
    setObjectiveEditError(null);
    setNewKeyResultTitle("");
    setSelection({ kind: "objective", id: o.id });
  }

  async function handleAddObjective(e: React.FormEvent) {
    e.preventDefault();
    if (!newObjectiveTitle.trim()) return;
    setObjectiveSubmitting(true);
    setObjectiveError(null);
    try {
      const res = await fetch("/api/org/objectives", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newObjectiveTitle }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Objectiveの追加に失敗しました");
      setNewObjectiveTitle("");
      await refreshObjectives();
      selectObjective({ ...data.objective, progress: [] });
    } catch (err) {
      setObjectiveError((err as Error).message);
    } finally {
      setObjectiveSubmitting(false);
    }
  }

  async function handleSaveObjectiveTitle() {
    if (!selectedObjective || !editObjectiveTitle.trim()) return;
    setObjectiveSaving(true);
    setObjectiveEditError(null);
    try {
      const res = await fetch(`/api/org/objectives/${selectedObjective.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: editObjectiveTitle }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "更新に失敗しました");
      await refreshObjectives();
    } catch (err) {
      setObjectiveEditError((err as Error).message);
    } finally {
      setObjectiveSaving(false);
    }
  }

  async function handleRemoveObjective(id: string) {
    try {
      await fetch(`/api/org/objectives/${id}`, { method: "DELETE" });
      if (selection?.kind === "objective" && selection.id === id) setSelection(null);
      await refreshObjectives();
    } catch {
      // 失敗時は次回のポーリングで状態が揃う
    }
  }

  async function handleAddKeyResult(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedObjective || !newKeyResultTitle.trim()) return;
    setKrSubmitting(true);
    try {
      const res = await fetch(`/api/org/objectives/${selectedObjective.id}/key-results`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newKeyResultTitle }),
      });
      if (res.ok) {
        setNewKeyResultTitle("");
        await refreshObjectives();
      }
    } finally {
      setKrSubmitting(false);
    }
  }

  async function handleRemoveKeyResult(keyResultId: string) {
    if (!selectedObjective) return;
    try {
      await fetch(`/api/org/objectives/${selectedObjective.id}/key-results/${keyResultId}`, { method: "DELETE" });
      await refreshObjectives();
    } catch {
      // 失敗時は次回のポーリングで状態が揃う
    }
  }

  return (
    <div className={`${styles.layout} ${styles.screen}`}>
      <div className={styles.panel}>
        <h2>Context Directory</h2>
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
          <div className={styles.treeFolder}>📁 Strategy（MVV）</div>
          <div
            className={`${styles.treeFile} ${selection?.kind === "strategy" ? styles.treeFileSelected : ""}`}
            onClick={selectStrategy}
          >
            📄 Strategy
          </div>

          <div className={styles.treeFolder} style={{ marginTop: 10 }}>📁 Objectives（OKR）</div>
          <form onSubmit={handleAddObjective} className={styles.treeAddRow}>
            <input
              type="text"
              value={newObjectiveTitle}
              onChange={(e) => setNewObjectiveTitle(e.target.value)}
              placeholder="新しいObjective"
            />
            <button className={styles.btnOutline} type="submit" disabled={objectiveSubmitting || !newObjectiveTitle.trim()}>
              追加
            </button>
          </form>
          {objectiveError && <p className={styles.errorText} role="alert">{objectiveError}</p>}
          {objectives.length === 0 && <p className={styles.subtitle}>まだObjectiveが登録されていません。</p>}
          {objectives.map((o) => (
            <div
              key={o.id}
              className={`${styles.treeFile} ${selection?.kind === "objective" && selection.id === o.id ? styles.treeFileSelected : ""}`}
              onClick={() => selectObjective(o)}
            >
              📄 {o.title}（KR {o.keyResults.length}件）
            </div>
          ))}

          <div className={styles.treeFolder} style={{ marginTop: 10 }}>📁 Teams（組織体制）</div>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.75rem", color: "var(--text-muted)", margin: "4px 0" }}>
            <input type="checkbox" checked={showArchivedTeams} onChange={(e) => setShowArchivedTeams(e.target.checked)} />
            アーカイブ済みも表示する
          </label>
          {visibleTeams.length === 0 && <p className={styles.subtitle}>まだチームが登録されていません。</p>}
          <TeamTreeView nodes={teamTree} depth={0} selection={selection} onSelect={selectTeam} />
        </div>
      </div>

      <div className={styles.panel}>
        {!selection && <p className={styles.emptyState}>左のツリーからStrategy・Objective・チームのいずれかを選択してください。</p>}

        {selection?.kind === "strategy" && (
          <>
            <div className={styles.editorPath}>
              <code>/Strategy</code>
              <button className={styles.primaryBtn} onClick={handleSaveStrategy} disabled={strategySaving}>
                {strategySaving ? "保存中…" : "保存"}
              </button>
            </div>
            <p className={styles.subtitle}>
              組織全体のMVVはIssueに依らず常にAgent Runtimeへ絶対の前提として注入されます。未入力の項目は注入されません。OKRは左の「Objectives」で管理します。
            </p>
            <div className={styles.field}>
              <label>Mission（生む価値・存在意義）
              <textarea
                rows={2}
                value={strategyDraft.mission}
                onChange={(e) => setStrategyDraft({ ...strategyDraft, mission: e.target.value })}
              /></label>
            </div>
            <div className={styles.field}>
              <label>Vision（目指す姿）
              <textarea
                rows={2}
                value={strategyDraft.vision}
                onChange={(e) => setStrategyDraft({ ...strategyDraft, vision: e.target.value })}
              /></label>
            </div>
            <div className={styles.field}>
              <label>Values（大事にする価値観）
              <textarea
                rows={2}
                value={strategyDraft.values}
                onChange={(e) => setStrategyDraft({ ...strategyDraft, values: e.target.value })}
              /></label>
            </div>
          </>
        )}

        {selectedObjective && (
          <>
            <div className={styles.editorPath}>
              <code>/Objectives/{selectedObjective.title}</code>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  className={styles.primaryBtn}
                  style={{ width: "auto" }}
                  onClick={handleSaveObjectiveTitle}
                  disabled={objectiveSaving || !editObjectiveTitle.trim()}
                >
                  {objectiveSaving ? "保存中…" : "保存"}
                </button>
                <button className={styles.btnOutline} onClick={() => handleRemoveObjective(selectedObjective.id)}>
                  このObjectiveを削除
                </button>
              </div>
            </div>
            <p className={styles.subtitle}>
              KeyResultへ紐付けたIssueの完了（アーカイブ）件数から進捗を自動算出します（手動での進捗入力はありません）。
            </p>
            <div className={styles.field}>
              <label>Objective（目標）
              <input type="text" value={editObjectiveTitle} onChange={(e) => setEditObjectiveTitle(e.target.value)} /></label>
            </div>
            {objectiveEditError && <p className={styles.errorText} role="alert">{objectiveEditError}</p>}

            <h3 style={{ marginTop: 16, marginBottom: 4, fontSize: "0.8125rem" }}>Key Results</h3>
            {selectedObjective.keyResults.length === 0 ? (
              <p className={styles.subtitle}>まだKey Resultがありません。</p>
            ) : (
              <div className={styles.tableWrap} style={{ marginBottom: 10 }}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Key Result</th>
                      <th>進捗</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedObjective.keyResults.map((kr) => {
                      const progress = selectedObjective.progress.find((p) => p.keyResultId === kr.id);
                      return (
                        <tr key={kr.id}>
                          <td>{kr.title}</td>
                          <td className={styles.tableMuted}>
                            {progress ? `Issue ${progress.done}/${progress.total}件 完了` : "紐付くIssueなし"}
                          </td>
                          <td>
                            <button className={styles.btnOutline} onClick={() => handleRemoveKeyResult(kr.id)}>
                              削除
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <form onSubmit={handleAddKeyResult} className={styles.treeAddRow}>
              <input
                type="text"
                value={newKeyResultTitle}
                onChange={(e) => setNewKeyResultTitle(e.target.value)}
                placeholder="新しいKey Result"
              />
              <button className={styles.btnOutline} type="submit" disabled={krSubmitting || !newKeyResultTitle.trim()}>
                追加
              </button>
            </form>

            {objectiveHistory.length > 0 && (
              <details style={{ marginTop: 20 }}>
                <summary style={{ cursor: "pointer", fontSize: "0.75rem", color: "var(--text-muted)" }}>
                  変更履歴（{objectiveHistory.length}件）
                </summary>
                <ul style={{ listStyle: "none", marginTop: 8 }}>
                  {objectiveHistory.map((h) => (
                    <li key={h.id} style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: 4 }}>
                      {new Date(h.occurredAt).toLocaleString("ja-JP")} — {h.text}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}

        {selectedTeam && (
          <>
            <div className={styles.editorPath}>
              <code>/Teams/{selectedTeam.name}</code>
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
            {editError && <p className={styles.errorText} role="alert">{editError}</p>}
            <button className={styles.primaryBtn} style={{ width: "auto" }} onClick={handleSaveTeam} disabled={editSaving || !editName.trim()}>
              {editSaving ? "保存中…" : "保存"}
            </button>

            <div className={styles.field} style={{ marginTop: 16 }}>
              <span className={styles.fieldCaption}>Members_Profile（保存済みの状態。クリックでPeopleへ）</span>
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
              Issueほど明確な課題ではないが、EMがメモしたメンバーの様子（直近10件）です。
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
