"use client";

import { useState } from "react";
import styles from "@/app/page.module.css";
import { Select } from "@/components/Select";
import { useEntityHistory, useObjectives, useOrgStrategy, useTeams } from "@/lib/hooks";
import { teamDisplayName, teamPathSegments, type ObjectiveWithProgress, type OrgStrategy, type Team } from "@/lib/types";

type Selection = { kind: "strategy" } | { kind: "objective"; id: string } | null;

// ユーザー要望「方針・目標タブでは、方針・目標の設定によりフォーカスした形にしたい」対応。
// チーム管理（Teams）は@/app/teams/page.tsx（チーム・メンバータブ）へ移設した。ここはEMが
// Agent Runtimeへ「絶対の前提」として注入する組織の憲法（MVV＝Strategy）と、戦略→Issue→結果を
// つなぐOKR（Objectives）だけに絞る。
//
// ユーザー指摘「目標は組織内でカスケーディングされるもの（上位組織の目標達成のために
// 下位組織の目標がある）」対応。ObjectiveにteamId（未指定＝組織全体、指定時はそのチーム自身の
// 目標）を持たせ、既存のチーム階層（Team.nameの"/"区切り）にそのままネストして表示する。
// MVVも同様にチーム単位のMission/制約（Team.charter、編集はチーム・メンバータブ）を
// 組織MVVの下に読み取り専用で並べ、カスケーディングを一望できるようにする。

// docs/memo.md TODO「チームの組織階層を入力できるようにする」への対応と同じツリー構造を、
// Objectiveの表示にも流用する（チームの親子関係にそのまま乗せるため、Objective側に
// 別途parentObjectiveId等は持たせない）。
type ObjectiveTreeNode = {
  segment: string;
  team?: Team;
  objectives: ObjectiveWithProgress[];
  children: ObjectiveTreeNode[];
};

function buildObjectiveTeamTree(teams: Team[], objectives: ObjectiveWithProgress[]): ObjectiveTreeNode[] {
  const root: ObjectiveTreeNode[] = [];
  for (const team of teams) {
    let level = root;
    let node: ObjectiveTreeNode | undefined;
    for (const segment of teamPathSegments(team.name)) {
      node = level.find((n) => n.segment === segment);
      if (!node) {
        node = { segment, objectives: [], children: [] };
        level.push(node);
      }
      level = node.children;
    }
    if (node) {
      node.team = team;
      node.objectives = objectives.filter((o) => o.teamId === team.id);
    }
  }
  const sortTree = (nodes: ObjectiveTreeNode[]) => {
    nodes.sort((a, b) => a.segment.localeCompare(b.segment, "ja"));
    for (const n of nodes) sortTree(n.children);
  };
  sortTree(root);
  return root;
}

function ObjectiveTeamTreeView({
  nodes,
  depth,
  selection,
  onSelectObjective,
}: {
  nodes: ObjectiveTreeNode[];
  depth: number;
  selection: Selection;
  onSelectObjective: (o: ObjectiveWithProgress) => void;
}) {
  return (
    <>
      {nodes.map((node) => (
        <div key={`${depth}-${node.segment}`}>
          <div className={styles.treeFolder} style={{ paddingLeft: depth * 14, marginTop: 4 }}>
            📁 {node.segment}
          </div>
          {node.objectives.map((o) => (
            <div
              key={o.id}
              className={`${styles.treeFile} ${
                selection?.kind === "objective" && selection.id === o.id ? styles.treeFileSelected : ""
              }`}
              style={{ paddingLeft: 20 + depth * 14 }}
              onClick={() => onSelectObjective(o)}
            >
              📄 {o.title}（KR {o.keyResults.length}件）
            </div>
          ))}
          {node.children.length > 0 && (
            <ObjectiveTeamTreeView nodes={node.children} depth={depth + 1} selection={selection} onSelectObjective={onSelectObjective} />
          )}
        </div>
      ))}
    </>
  );
}

export default function OrgContextPage() {
  const { strategy, refreshStrategy } = useOrgStrategy();
  const { objectives, refreshObjectives } = useObjectives();
  const { teams } = useTeams();
  const activeTeams = teams.filter((t) => !t.archived);
  const teamOptions = activeTeams.map((t) => ({ value: t.id, label: teamDisplayName(t.name) }));

  const [selection, setSelection] = useState<Selection>(null);

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

  // docs/memo.md「H. 戦略→Issue→結果の一本線」対応。Objective/KeyResultの管理。
  // Strategyと同じ「ツリーを選んだ瞬間だけドラフトへコピー」方式にする。
  const selectedObjective = selection?.kind === "objective" ? objectives.find((o) => o.id === selection.id) ?? null : null;
  const { history: objectiveHistory } = useEntityHistory("org", selectedObjective?.id ?? null);

  const orgWideObjectives = objectives.filter((o) => !o.teamId);
  const objectiveTeamTree = buildObjectiveTeamTree(activeTeams, objectives);

  const [newObjectiveTitle, setNewObjectiveTitle] = useState("");
  const [newObjectiveTeamId, setNewObjectiveTeamId] = useState("");
  const [objectiveSubmitting, setObjectiveSubmitting] = useState(false);
  const [objectiveError, setObjectiveError] = useState<string | null>(null);

  const [editObjectiveTitle, setEditObjectiveTitle] = useState("");
  const [editObjectiveTeamId, setEditObjectiveTeamId] = useState("");
  const [objectiveSaving, setObjectiveSaving] = useState(false);
  const [objectiveEditError, setObjectiveEditError] = useState<string | null>(null);
  const [newKeyResultTitle, setNewKeyResultTitle] = useState("");
  const [krSubmitting, setKrSubmitting] = useState(false);

  function selectObjective(o: ObjectiveWithProgress) {
    setEditObjectiveTitle(o.title);
    setEditObjectiveTeamId(o.teamId ?? "");
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
        body: JSON.stringify({ title: newObjectiveTitle, teamId: newObjectiveTeamId || undefined }),
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

  async function handleSaveObjective() {
    if (!selectedObjective || !editObjectiveTitle.trim()) return;
    setObjectiveSaving(true);
    setObjectiveEditError(null);
    try {
      const res = await fetch(`/api/org/objectives/${selectedObjective.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: editObjectiveTitle, teamId: editObjectiveTeamId || null }),
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

  // ユーザー指摘「目標のカスケーディング」対応。MVVもTeam.charterというチーム単位の
  // Mission/制約を既に持っているため、組織MVVの下に参考として並べる（編集はチーム・メンバー
  // タブで行う——ここでの二重編集導線は作らない）。未設定のチームは載せない。
  const teamsWithCharter = activeTeams
    .filter((t) => t.charter.mission.trim() || t.charter.constraints.trim())
    .sort((a, b) => teamDisplayName(a.name).localeCompare(teamDisplayName(b.name), "ja"));

  return (
    <div className={`${styles.layout} ${styles.screen}`}>
      <div className={styles.panel}>
        <h2>方針・目標</h2>
        <p className={styles.subtitle}>
          組織のMVV（Strategy）とOKR（Objectives）——EMが「不動の前提」としてAgent
          Runtimeへ常に注入する情報です。目標は組織全体からチームへとカスケードする構造で管理します（チームの追加・編集は「チーム・メンバー」タブで行います）。
        </p>

        <div className={styles.tree} style={{ marginTop: 14 }}>
          <div className={styles.treeFolder}>📁 Strategy（MVV）</div>
          <div
            className={`${styles.treeFile} ${selection?.kind === "strategy" ? styles.treeFileSelected : ""}`}
            onClick={selectStrategy}
          >
            📄 Strategy
          </div>

          <div className={styles.treeFolder} style={{ marginTop: 10 }}>📁 Objectives（OKR）</div>
          {/* ユーザー指摘「追加ボタンがパネルからはみ出している」対応。.treeAddRowは
              display:flex（wrapなし）+input flex:1の1行レイアウトで、テキスト入力と
              ボタンの2要素だけを想定していた。所属チームSelect（最小幅140px）を同じ行に
              入れるとサイドパネル幅（280〜320px）を超えてはみ出すため、タイトル入力を
              1行目、所属チーム＋追加ボタンを2行目に分ける。 */}
          <form onSubmit={handleAddObjective} style={{ margin: "4px 0" }}>
            <input
              type="text"
              value={newObjectiveTitle}
              onChange={(e) => setNewObjectiveTitle(e.target.value)}
              placeholder="新しいObjective"
              style={{ width: "100%", border: "1px solid var(--input-border)", borderRadius: 6, padding: "4px 8px", fontSize: "0.8125rem" }}
            />
            <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
              <Select
                value={newObjectiveTeamId}
                onChange={setNewObjectiveTeamId}
                options={[{ value: "", label: "組織全体" }, ...teamOptions]}
                label="所属チーム"
                style={{ flex: 1, minWidth: 0 }}
              />
              <button className={styles.btnOutline} type="submit" disabled={objectiveSubmitting || !newObjectiveTitle.trim()}>
                追加
              </button>
            </div>
          </form>
          {objectiveError && <p className={styles.errorText} role="alert">{objectiveError}</p>}
          {objectives.length === 0 && <p className={styles.subtitle}>まだObjectiveが登録されていません。</p>}

          {/* ユーザー指摘「組織全体のOKRが入力の下にそのまま置かれていてわかりにくい」対応。
              チームのOKR（📁 チーム名の下にネスト）と同じ見た目にするため、組織全体の目標
              （teamId未設定）も「📁 組織全体」フォルダの下に並べる。その下にチーム階層と
              同じ構造で各チーム自身の目標をネスト表示し、上位目標→下位目標のカスケードを
              一望できるようにする。 */}
          <div className={styles.treeFolder} style={{ marginTop: 4 }}>📁 組織全体</div>
          {orgWideObjectives.map((o) => (
            <div
              key={o.id}
              className={`${styles.treeFile} ${
                selection?.kind === "objective" && selection.id === o.id ? styles.treeFileSelected : ""
              }`}
              style={{ paddingLeft: 20 }}
              onClick={() => selectObjective(o)}
            >
              📄 {o.title}（KR {o.keyResults.length}件）
            </div>
          ))}
          <ObjectiveTeamTreeView nodes={objectiveTeamTree} depth={0} selection={selection} onSelectObjective={selectObjective} />
        </div>
      </div>

      <div className={styles.panel}>
        {!selection && <p className={styles.emptyState}>左のツリーからStrategyまたはObjectiveを選択してください。</p>}

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

            <h3 style={{ marginTop: 20, marginBottom: 4, fontSize: "0.8125rem" }}>
              チームごとのMission・制約（参考、編集は「チーム・メンバー」タブで）
            </h3>
            <p className={styles.subtitle} style={{ marginBottom: 8 }}>
              組織全体のMVVを受けて、各チームが自分たちのMission・制約をどう定めているかの一覧です（Mission・制約のどちらかを設定しているチームのみ表示）。
            </p>
            {teamsWithCharter.length === 0 ? (
              <p className={styles.subtitle}>Mission・制約を設定しているチームはまだありません。</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {teamsWithCharter.map((t) => (
                  <div key={t.id} className={styles.field} style={{ margin: 0 }}>
                    <span className={styles.fieldCaption}>{teamDisplayName(t.name)}</span>
                    {t.charter.mission.trim() && (
                      <p style={{ margin: "2px 0", fontSize: "0.8125rem" }}>Mission: {t.charter.mission}</p>
                    )}
                    {t.charter.constraints.trim() && (
                      <p style={{ margin: "2px 0", fontSize: "0.8125rem", color: "var(--text-muted)" }}>
                        制約: {t.charter.constraints}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
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
                  onClick={handleSaveObjective}
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
            <div className={styles.field}>
              <span className={styles.fieldCaption}>所属チーム（未指定＝組織全体の目標）</span>
              <Select
                value={editObjectiveTeamId}
                onChange={setEditObjectiveTeamId}
                options={[{ value: "", label: "組織全体" }, ...teamOptions]}
                label="所属チーム"
                style={{ width: "100%" }}
              />
            </div>
            <p className={styles.subtitle} style={{ marginBottom: 8 }}>
              チームを指定すると、そのチームが組織の上位目標を達成するために追う下位目標として、左のツリーでチーム配下にネスト表示されます。
            </p>
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
      </div>
    </div>
  );
}
