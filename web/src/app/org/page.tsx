"use client";

import { useEffect, useState } from "react";
import styles from "@/app/page.module.css";
import { Select } from "@/components/Select";
import { useEntityHistory, useObjectives, useOrgStrategy, useTeams } from "@/lib/hooks";
import {
  teamDisplayName,
  teamPathSegments,
  type ObjectiveImportDraft,
  type ObjectiveWithProgress,
  type OrgStrategy,
  type Team,
} from "@/lib/types";

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

function treeTitle(title: string): string {
  const first = title.split("\n")[0]?.trim() || title;
  return title.includes("\n") ? `${first}…` : first;
}

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
              📄 {treeTitle(o.title)}（KR {o.keyResults.length}件）
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
  const { strategy, strategyLoaded, refreshStrategy } = useOrgStrategy();
  const { objectives, objectivesLoaded, refreshObjectives } = useObjectives();
  const { teams, teamsLoaded } = useTeams();
  const activeTeams = teams.filter((t) => !t.archived);
  const teamOptions = activeTeams.map((t) => ({ value: t.id, label: teamDisplayName(t.name) }));

  const [selection, setSelection] = useState<Selection>(null);

  const [strategyDraft, setStrategyDraft] = useState<OrgStrategy>(strategy);
  const [strategySaving, setStrategySaving] = useState(false);

  // SettingsのrulesLoaded/seededと同じ。初回フェッチ完了前の空fallbackを
  // 編集ドラフトに載せない（未入力のまま保存する事故を防ぐ）。
  const [strategySeeded, setStrategySeeded] = useState(false);
  if (strategyLoaded && !strategySeeded) {
    setStrategySeeded(true);
    setStrategyDraft(strategy);
  }

  // ポーリングで取得したstrategyは、Strategyノードをクリックした瞬間にだけ
  // 編集用ドラフトへコピーする（effectで継続的に同期すると、EMが編集中の内容を
  // 次のポーリングが上書きしてしまうため）。
  function selectStrategy() {
    if (strategyLoaded) setStrategyDraft(strategy);
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
  const [editObjectiveNote, setEditObjectiveNote] = useState("");
  const [editObjectiveTeamId, setEditObjectiveTeamId] = useState("");
  const [objectiveSaving, setObjectiveSaving] = useState(false);
  const [objectiveEditError, setObjectiveEditError] = useState<string | null>(null);
  const [newKeyResultTitle, setNewKeyResultTitle] = useState("");
  const [krSubmitting, setKrSubmitting] = useState(false);
  const [krDrafts, setKrDrafts] = useState<Record<string, string>>({});
  const [krSavingId, setKrSavingId] = useState<string | null>(null);
  const [krEditError, setKrEditError] = useState<string | null>(null);

  // docs/usage_issues U18: テキスト一括取り込み。
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importTeamId, setImportTeamId] = useState("");
  const [importMode, setImportMode] = useState<"append" | "replace">("append");
  const [importDrafts, setImportDrafts] = useState<ObjectiveImportDraft[] | null>(null);
  const [importSource, setImportSource] = useState<"cloud" | "heuristic" | null>(null);
  const [importParsing, setImportParsing] = useState(false);
  const [importSaving, setImportSaving] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  function selectObjective(o: ObjectiveWithProgress) {
    setEditObjectiveTitle(o.title);
    setEditObjectiveNote(o.note ?? "");
    setEditObjectiveTeamId(o.teamId ?? "");
    setObjectiveEditError(null);
    setKrEditError(null);
    setNewKeyResultTitle("");
    setKrDrafts(Object.fromEntries(o.keyResults.map((kr) => [kr.id, kr.title])));
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
        body: JSON.stringify({
          title: editObjectiveTitle,
          teamId: editObjectiveTeamId || null,
          note: editObjectiveNote,
        }),
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
    setKrEditError(null);
    try {
      const res = await fetch(`/api/org/objectives/${selectedObjective.id}/key-results`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newKeyResultTitle }),
      });
      if (res.ok) {
        setNewKeyResultTitle("");
        await refreshObjectives();
        // 追加後の一覧をドラフトに反映するため、次の選択時に揃う。ここでも最新を取りに行く。
        const data = await res.json();
        const objective = data.objective as ObjectiveWithProgress | undefined;
        if (objective?.keyResults) {
          setKrDrafts(Object.fromEntries(objective.keyResults.map((kr) => [kr.id, kr.title])));
        }
      }
    } finally {
      setKrSubmitting(false);
    }
  }

  async function handleSaveKeyResult(keyResultId: string) {
    if (!selectedObjective) return;
    const title = (krDrafts[keyResultId] ?? "").trim();
    if (!title) return;
    setKrSavingId(keyResultId);
    setKrEditError(null);
    try {
      const res = await fetch(`/api/org/objectives/${selectedObjective.id}/key-results/${keyResultId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Key Resultの更新に失敗しました");
      await refreshObjectives();
    } catch (err) {
      setKrEditError((err as Error).message);
    } finally {
      setKrSavingId(null);
    }
  }

  async function handleRemoveKeyResult(keyResultId: string) {
    if (!selectedObjective) return;
    try {
      await fetch(`/api/org/objectives/${selectedObjective.id}/key-results/${keyResultId}`, { method: "DELETE" });
      setKrDrafts((prev) => {
        const next = { ...prev };
        delete next[keyResultId];
        return next;
      });
      await refreshObjectives();
    } catch {
      // 失敗時は次回のポーリングで状態が揃う
    }
  }

  async function handleParseImport() {
    if (!importText.trim()) return;
    setImportParsing(true);
    setImportError(null);
    try {
      const res = await fetch("/api/org/objectives/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: importText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "構造化に失敗しました");
      const drafts = Array.isArray(data.objectives) ? (data.objectives as ObjectiveImportDraft[]) : [];
      if (drafts.length === 0) throw new Error("Objectiveを抽出できませんでした。文言を見直すか、手で追記してください。");
      setImportDrafts(drafts);
      setImportSource(data.source === "cloud" ? "cloud" : "heuristic");
    } catch (err) {
      setImportError((err as Error).message);
      setImportDrafts(null);
      setImportSource(null);
    } finally {
      setImportParsing(false);
    }
  }

  async function handleSaveImport() {
    if (!importDrafts || importDrafts.length === 0) return;
    if (importMode === "replace") {
      const scopeLabel = importTeamId
        ? teamOptions.find((t) => t.value === importTeamId)?.label ?? "選択チーム"
        : "組織全体";
      const ok = window.confirm(
        `${scopeLabel}の既存Objectiveをすべて削除してから取り込みます。よろしいですか？`,
      );
      if (!ok) return;
    }
    setImportSaving(true);
    setImportError(null);
    try {
      const res = await fetch("/api/org/objectives/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: importMode,
          teamId: importTeamId || undefined,
          objectives: importDrafts,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "取り込みに失敗しました");
      setImportText("");
      setImportDrafts(null);
      setImportSource(null);
      setImportOpen(false);
      await refreshObjectives();
      const first = Array.isArray(data.objectives) ? data.objectives[0] : null;
      if (first) selectObjective({ ...first, progress: first.progress ?? [] });
    } catch (err) {
      setImportError((err as Error).message);
    } finally {
      setImportSaving(false);
    }
  }

  function updateImportDraft(index: number, patch: Partial<ObjectiveImportDraft>) {
    setImportDrafts((prev) => {
      if (!prev) return prev;
      return prev.map((d, i) => (i === index ? { ...d, ...patch } : d));
    });
  }

  function updateImportKr(index: number, krIndex: number, title: string) {
    setImportDrafts((prev) => {
      if (!prev) return prev;
      return prev.map((d, i) => {
        if (i !== index) return d;
        const keyResults = [...d.keyResults];
        keyResults[krIndex] = title;
        return { ...d, keyResults };
      });
    });
  }

  function addImportKr(index: number) {
    setImportDrafts((prev) => {
      if (!prev) return prev;
      return prev.map((d, i) => (i === index ? { ...d, keyResults: [...d.keyResults, ""] } : d));
    });
  }

  function removeImportKr(index: number, krIndex: number) {
    setImportDrafts((prev) => {
      if (!prev) return prev;
      return prev.map((d, i) =>
        i === index ? { ...d, keyResults: d.keyResults.filter((_, j) => j !== krIndex) } : d,
      );
    });
  }

  function removeImportDraft(index: number) {
    setImportDrafts((prev) => (prev ? prev.filter((_, i) => i !== index) : prev));
  }

  // ユーザー指摘「目標のカスケーディング」対応。MVVもTeam.charterというチーム単位の
  // Mission/制約を既に持っているため、組織MVVの下に参考として並べる（編集はチーム・メンバー
  // タブで行う——ここでの二重編集導線は作らない）。未設定のチームは載せない。
  const teamsWithCharter = activeTeams
    .filter((t) => t.charter.mission.trim() || t.charter.constraints.trim())
    .sort((a, b) => teamDisplayName(a.name).localeCompare(teamDisplayName(b.name), "ja"));

  // ポーリングや他操作で KR が増減したとき、未編集のドラフトだけ同期する。
  useEffect(() => {
    if (!selectedObjective) return;
    setKrDrafts((prev) => {
      const next = { ...prev };
      let changed = false;
      const ids = new Set(selectedObjective.keyResults.map((kr) => kr.id));
      for (const kr of selectedObjective.keyResults) {
        if (next[kr.id] === undefined) {
          next[kr.id] = kr.title;
          changed = true;
        }
      }
      for (const id of Object.keys(next)) {
        if (!ids.has(id)) {
          delete next[id];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [selectedObjective]);

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
          <div style={{ margin: "4px 0", display: "flex", gap: 6 }}>
            <button
              type="button"
              className={styles.btnOutline}
              style={{ flex: 1 }}
              onClick={() => {
                setImportOpen((v) => !v);
                setImportError(null);
              }}
            >
              {importOpen ? "取り込みを閉じる" : "テキストから取り込む"}
            </button>
          </div>
          {/* ユーザー指摘「追加ボタンがパネルからはみ出している」対応。.treeAddRowは
              display:flex（wrapなし）+input flex:1の1行レイアウトで、テキスト入力と
              ボタンの2要素だけを想定していた。所属チームSelect（最小幅140px）を同じ行に
              入れるとサイドパネル幅（280〜320px）を超えてはみ出すため、タイトル入力を
              1行目、所属チーム＋追加ボタンを2行目に分ける。 */}
          <form onSubmit={handleAddObjective} style={{ margin: "4px 0" }}>
            <textarea
              rows={2}
              value={newObjectiveTitle}
              onChange={(e) => setNewObjectiveTitle(e.target.value)}
              placeholder="新しいObjective（改行可）"
              style={{ width: "100%", border: "1px solid var(--input-border)", borderRadius: 6, padding: "4px 8px", fontSize: "0.8125rem", resize: "vertical" }}
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
          {!objectivesLoaded ? (
            <p className={styles.subtitle}>読み込み中…</p>
          ) : (
            objectives.length === 0 && <p className={styles.subtitle}>まだObjectiveが登録されていません。</p>
          )}

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
              📄 {treeTitle(o.title)}（KR {o.keyResults.length}件）
            </div>
          ))}
          <ObjectiveTeamTreeView nodes={objectiveTeamTree} depth={0} selection={selection} onSelectObjective={selectObjective} />
        </div>
      </div>

      <div className={styles.panel}>
        {importOpen && (
          <>
            <div className={styles.editorPath}>
              <code>/Objectives/import</code>
            </div>
            <p className={styles.subtitle}>
              既存のOKR全文を貼り付け、外部AI（SettingsのCLI優先順。失敗時や構造が明確なMarkdownのときはルールベース）で Objective / Key Result / メモに分解します。プレビューで直してから、追記または同一スコープの差し替えで保存できます。
            </p>
            <div className={styles.field}>
              <label>OKRテキスト
              <textarea
                rows={8}
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                placeholder={"例:\nObjective: プロダクトの信頼性を上げる\nメモ: インシデントが増えたため\n- 重大インシデントを半期で50%削減\n- デプロイ失敗率を1%未満に"}
              /></label>
            </div>
            <div className={styles.field}>
              <span className={styles.fieldCaption}>取り込み先（所属チーム）</span>
              <Select
                value={importTeamId}
                onChange={setImportTeamId}
                options={[{ value: "", label: "組織全体" }, ...teamOptions]}
                label="取り込み先"
                style={{ width: "100%" }}
              />
            </div>
            <div className={styles.field}>
              <span className={styles.fieldCaption}>保存モード</span>
              <div style={{ display: "flex", gap: 12, fontSize: "0.8125rem" }}>
                <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input
                    type="radio"
                    name="importMode"
                    checked={importMode === "append"}
                    onChange={() => setImportMode("append")}
                  />
                  追記（既存は残す）
                </label>
                <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input
                    type="radio"
                    name="importMode"
                    checked={importMode === "replace"}
                    onChange={() => setImportMode("replace")}
                  />
                  差し替え（同一スコープの既存を削除）
                </label>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              <button
                type="button"
                className={styles.primaryBtn}
                style={{ width: "auto" }}
                onClick={handleParseImport}
                disabled={importParsing || !importText.trim()}
              >
                {importParsing ? "構造化中…" : "構造化する"}
              </button>
              <button
                type="button"
                className={styles.btnOutline}
                onClick={handleSaveImport}
                disabled={importSaving || !importDrafts || importDrafts.length === 0}
              >
                {importSaving ? "保存中…" : "この内容で保存"}
              </button>
            </div>
            {importSource && (
              <p className={styles.subtitle}>
                分解元: {importSource === "cloud" ? "外部AI（CLI）" : "ルールベース"}
              </p>
            )}
            {importError && <p className={styles.errorText} role="alert">{importError}</p>}
            {importDrafts && (
              <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 8 }}>
                {importDrafts.map((draft, index) => (
                  <div key={index} className={styles.field} style={{ margin: 0, padding: 10, border: "1px solid var(--input-border)", borderRadius: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
                      <span className={styles.fieldCaption}>Objective {index + 1}</span>
                      <button type="button" className={styles.btnOutline} onClick={() => removeImportDraft(index)}>
                        このObjectiveを除く
                      </button>
                    </div>
                    <label>タイトル
                    <textarea
                      rows={2}
                      value={draft.title}
                      onChange={(e) => updateImportDraft(index, { title: e.target.value })}
                    /></label>
                    <label style={{ marginTop: 8, display: "block" }}>メモ（任意）
                    <textarea
                      rows={2}
                      value={draft.note ?? ""}
                      onChange={(e) => updateImportDraft(index, { note: e.target.value })}
                    /></label>
                    <span className={styles.fieldCaption} style={{ marginTop: 8, display: "block" }}>Key Results</span>
                    {draft.keyResults.map((kr, krIndex) => (
                      <div key={krIndex} style={{ display: "flex", gap: 6, marginTop: 6, alignItems: "flex-start" }}>
                        <textarea
                          rows={2}
                          value={kr}
                          onChange={(e) => updateImportKr(index, krIndex, e.target.value)}
                          style={{ flex: 1, minWidth: 0 }}
                        />
                        <button type="button" className={styles.btnOutline} onClick={() => removeImportKr(index, krIndex)}>
                          削除
                        </button>
                      </div>
                    ))}
                    <button type="button" className={styles.btnOutline} style={{ marginTop: 8 }} onClick={() => addImportKr(index)}>
                      KRを追加
                    </button>
                  </div>
                ))}
              </div>
            )}
            <hr style={{ margin: "20px 0", border: 0, borderTop: "1px solid var(--input-border)" }} />
          </>
        )}

        {!selection && !importOpen && <p className={styles.emptyState}>左のツリーからStrategyまたはObjectiveを選択してください。</p>}

        {selection?.kind === "strategy" && (
          <>
            <div className={styles.editorPath}>
              <code>/Strategy</code>
              <button className={styles.primaryBtn} onClick={handleSaveStrategy} disabled={strategySaving || !strategySeeded}>
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
              <p className={styles.subtitle}>
                {!teamsLoaded ? "読み込み中…" : "Mission・制約を設定しているチームはまだありません。"}
              </p>
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
              <code>/Objectives/{treeTitle(selectedObjective.title)}</code>
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
              KeyResultへ紐付けたIssueのうち、追っていない（アーカイブ）ものを除き、ステータス完了（解決）件数から進捗を自動算出します（手動での進捗入力はありません）。
            </p>
            <div className={styles.field}>
              <label>Objective（目標）
              <textarea
                rows={3}
                value={editObjectiveTitle}
                onChange={(e) => setEditObjectiveTitle(e.target.value)}
              /></label>
            </div>
            <div className={styles.field}>
              <label>メモ（判断の理由などの補足）
              <textarea
                rows={3}
                value={editObjectiveNote}
                onChange={(e) => setEditObjectiveNote(e.target.value)}
                placeholder="この目標にした理由・前提・例外など"
              /></label>
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
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 10 }}>
                {selectedObjective.keyResults.map((kr) => {
                  const progress = selectedObjective.progress.find((p) => p.keyResultId === kr.id);
                  const draft = krDrafts[kr.id] ?? kr.title;
                  const dirty = draft.trim() !== kr.title;
                  return (
                    <div
                      key={kr.id}
                      className={styles.field}
                      style={{ marginBottom: 0, border: "1px solid var(--input-border)", borderRadius: 8, padding: 10 }}
                    >
                      <textarea
                        rows={2}
                        value={draft}
                        onChange={(e) => setKrDrafts((prev) => ({ ...prev, [kr.id]: e.target.value }))}
                      />
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 8, alignItems: "center" }}>
                        <span className={styles.tableMuted} style={{ fontSize: "0.75rem" }}>
                          {progress ? `Issue ${progress.done}/${progress.total}件 完了` : "紐付くIssueなし"}
                        </span>
                        <div style={{ display: "flex", gap: 6 }}>
                          <button
                            type="button"
                            className={styles.primaryBtn}
                            style={{ width: "auto" }}
                            disabled={krSavingId === kr.id || !draft.trim() || !dirty}
                            onClick={() => handleSaveKeyResult(kr.id)}
                          >
                            {krSavingId === kr.id ? "保存中…" : "保存"}
                          </button>
                          <button type="button" className={styles.btnOutline} onClick={() => handleRemoveKeyResult(kr.id)}>
                            削除
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {krEditError && <p className={styles.errorText} role="alert">{krEditError}</p>}
            <form onSubmit={handleAddKeyResult} className={styles.field} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <textarea
                rows={2}
                value={newKeyResultTitle}
                onChange={(e) => setNewKeyResultTitle(e.target.value)}
                placeholder="新しいKey Result（改行可）"
              />
              <button
                className={styles.btnOutline}
                type="submit"
                disabled={krSubmitting || !newKeyResultTitle.trim()}
                style={{ alignSelf: "flex-start" }}
              >
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
