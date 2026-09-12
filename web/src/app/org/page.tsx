"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import styles from "@/app/page.module.css";
import { Select } from "@/components/Select";
import { useEntityHistory, useObjectives, useOrgBackgrounds, useOrgStrategy, useTeams, useThemes } from "@/lib/hooks";
import {
  teamDisplayName,
  teamPathSegments,
  type ObjectiveImportDraft,
  type ObjectiveWithProgress,
  type OrgBackgroundEntry,
  type OrgStrategy,
  type Team,
} from "@/lib/types";

type Selection =
  | { kind: "strategy" }
  | { kind: "backgrounds" }
  | { kind: "objectives" }
  | null;

// ユーザー要望「方針・目標タブでは、方針・目標の設定によりフォーカスした形にしたい」対応。
// チーム管理（Teams）は@/app/teams/page.tsx（チーム・メンバータブ）へ移設した。ここはEMが
// Agent Runtimeへ「絶対の前提」として注入する組織の憲法（MVV＝Strategy）と、戦略→Issue→結果を
// つなぐOKR（Objectives）、および Standing Background（長期の背景事実）に絞る。
// Strategy / Standing Background / Objectives はいずれも左ツリーは入口だけで、追加・一覧・編集は右パネルの専用ビューで行う。
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

function objectiveProgressLabel(o: ObjectiveWithProgress): string {
  const total = o.progress.reduce((sum, p) => sum + p.total, 0);
  const done = o.progress.reduce((sum, p) => sum + p.done, 0);
  return `KR ${o.keyResults.length}件` + (total > 0 ? ` · Issue ${done}/${total}` : "");
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

function ObjectiveListCard({
  objective,
  onSelect,
}: {
  objective: ObjectiveWithProgress;
  onSelect: (o: ObjectiveWithProgress) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(objective)}
      style={{
        textAlign: "left",
        padding: "10px 12px",
        border: "1px solid var(--input-border)",
        borderRadius: 8,
        background: "var(--panel-bg, transparent)",
        cursor: "pointer",
        width: "100%",
      }}
    >
      <div style={{ fontSize: "0.875rem", fontWeight: 600 }}>{treeTitle(objective.title)}</div>
      <div style={{ marginTop: 4, fontSize: "0.75rem", color: "var(--text-muted)" }}>
        {objectiveProgressLabel(objective)}
      </div>
      {objective.note?.trim() && (
        <div style={{ marginTop: 6, fontSize: "0.8125rem", color: "var(--text-muted)" }}>
          {objective.note.length > 120 ? `${objective.note.slice(0, 120)}…` : objective.note}
        </div>
      )}
    </button>
  );
}

function ObjectiveTeamListView({
  nodes,
  depth,
  onSelectObjective,
}: {
  nodes: ObjectiveTreeNode[];
  depth: number;
  onSelectObjective: (o: ObjectiveWithProgress) => void;
}) {
  return (
    <>
      {nodes.map((node) => (
        <div key={`${depth}-${node.segment}`} style={{ marginTop: depth === 0 ? 12 : 8 }}>
          <div
            style={{
              fontSize: "0.8125rem",
              fontWeight: 600,
              color: "var(--text)",
              marginBottom: 4,
              paddingLeft: depth * 12,
            }}
          >
            {node.segment}
          </div>
          {node.team && (
            <div style={{ paddingLeft: depth * 12, marginBottom: node.children.length > 0 ? 4 : 0 }}>
              {node.objectives.length > 0 ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {node.objectives.map((o) => (
                    <ObjectiveListCard key={o.id} objective={o} onSelect={onSelectObjective} />
                  ))}
                </div>
              ) : (
                <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--text-muted)" }}>
                  登録なし
                </p>
              )}
            </div>
          )}
          {node.children.length > 0 && (
            <ObjectiveTeamListView nodes={node.children} depth={depth + 1} onSelectObjective={onSelectObjective} />
          )}
        </div>
      ))}
    </>
  );
}

export default function OrgContextPage() {
  return (
    <Suspense fallback={null}>
      <OrgContextPageInner />
    </Suspense>
  );
}

// Issue詳細・一覧などから `?objective=<id>` で飛んできたとき、該当 Objective を右パネルで開く。
function OrgContextPageInner() {
  const searchParams = useSearchParams();
  const objectiveFocusId = searchParams.get("objective");

  const { strategy, strategyLoaded, refreshStrategy } = useOrgStrategy();
  const { backgrounds, backgroundsLoaded, refreshBackgrounds } = useOrgBackgrounds();
  const { objectives, objectivesLoaded, refreshObjectives } = useObjectives();
  const { teams, teamsLoaded } = useTeams();
  const { themes, refreshThemes } = useThemes();
  const activeTeams = teams.filter((t) => !t.archived);
  const teamOptions = activeTeams.map((t) => ({ value: t.id, label: teamDisplayName(t.name) }));

  const [selection, setSelection] = useState<Selection>(null);
  const [appliedObjectiveFocusId, setAppliedObjectiveFocusId] = useState<string | null>(null);

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
    setEditingBackgroundId(null);
    setEditingObjectiveId(null);
    setImportOpen(false);
    setSelection({ kind: "strategy" });
  }

  // SettingsのisDirtyと同じ。未変更のまま保存できて「保存されたかわからない」状態に
  // ならないよう、サーバー最新値とドラフトを比較する。
  const strategyDirty = strategySeeded && JSON.stringify(strategyDraft) !== JSON.stringify(strategy);

  async function handleSaveStrategy() {
    if (!strategyDirty) return;
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

  // Standing Background（長期の背景事実）。Strategy と同様、左ツリーは入口だけで
  // 追加・一覧・編集・削除は右パネルの専用ビューで行う。
  const [editingBackgroundId, setEditingBackgroundId] = useState<string | null>(null);
  const selectedBackground =
    editingBackgroundId ? backgrounds.find((b) => b.id === editingBackgroundId) ?? null : null;
  const { history: backgroundHistory } = useEntityHistory("org", selectedBackground?.id ?? null);
  const [showArchivedBackgrounds, setShowArchivedBackgrounds] = useState(false);
  const visibleBackgrounds = backgrounds.filter((b) => showArchivedBackgrounds || b.status === "active");

  const [newBgTitle, setNewBgTitle] = useState("");
  const [newBgFact, setNewBgFact] = useState("");
  const [newBgImplication, setNewBgImplication] = useState("");
  const [newBgOccurredOn, setNewBgOccurredOn] = useState("");
  const [newBgTags, setNewBgTags] = useState("");
  const [newBgScope, setNewBgScope] = useState<"always" | "tagged">("always");
  const [bgSubmitting, setBgSubmitting] = useState(false);
  const [bgError, setBgError] = useState<string | null>(null);

  const [editBgTitle, setEditBgTitle] = useState("");
  const [editBgFact, setEditBgFact] = useState("");
  const [editBgImplication, setEditBgImplication] = useState("");
  const [editBgOccurredOn, setEditBgOccurredOn] = useState("");
  const [editBgTags, setEditBgTags] = useState("");
  const [editBgScope, setEditBgScope] = useState<"always" | "tagged">("always");
  const [editBgStatus, setEditBgStatus] = useState<"active" | "archived">("active");
  const [bgSaving, setBgSaving] = useState(false);
  const [bgEditError, setBgEditError] = useState<string | null>(null);

  function selectBackgroundsView() {
    setEditingBackgroundId(null);
    setEditingObjectiveId(null);
    setImportOpen(false);
    setBgError(null);
    setBgEditError(null);
    setSelection({ kind: "backgrounds" });
  }

  function beginEditBackground(entry: OrgBackgroundEntry) {
    setEditBgTitle(entry.title);
    setEditBgFact(entry.fact);
    setEditBgImplication(entry.implication);
    setEditBgOccurredOn(entry.occurredOn ?? "");
    setEditBgTags(entry.tags.join(", "));
    setEditBgScope(entry.scope);
    setEditBgStatus(entry.status);
    setBgEditError(null);
    setEditingBackgroundId(entry.id);
  }

  function cancelEditBackground() {
    setEditingBackgroundId(null);
    setBgEditError(null);
  }

  function parseTagInput(raw: string): string[] {
    return raw
      .split(/[,、]/)
      .map((t) => t.trim())
      .filter(Boolean);
  }

  async function handleAddBackground(e: React.FormEvent) {
    e.preventDefault();
    if (!newBgTitle.trim() || !newBgFact.trim()) return;
    setBgSubmitting(true);
    setBgError(null);
    try {
      const res = await fetch("/api/org/background", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newBgTitle.trim(),
          fact: newBgFact.trim(),
          implication: newBgImplication.trim() || undefined,
          occurredOn: newBgOccurredOn.trim() || undefined,
          tags: parseTagInput(newBgTags),
          scope: newBgScope,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "追加に失敗しました");
      setNewBgTitle("");
      setNewBgFact("");
      setNewBgImplication("");
      setNewBgOccurredOn("");
      setNewBgTags("");
      setNewBgScope("always");
      await refreshBackgrounds();
      beginEditBackground(data.background);
    } catch (err) {
      setBgError((err as Error).message);
    } finally {
      setBgSubmitting(false);
    }
  }

  const backgroundDirty =
    !!selectedBackground &&
    (editBgTitle !== selectedBackground.title ||
      editBgFact !== selectedBackground.fact ||
      editBgImplication !== selectedBackground.implication ||
      editBgOccurredOn !== (selectedBackground.occurredOn ?? "") ||
      editBgTags !== selectedBackground.tags.join(", ") ||
      editBgScope !== selectedBackground.scope ||
      editBgStatus !== selectedBackground.status);

  async function handleSaveBackground() {
    if (!selectedBackground || !editBgTitle.trim() || !editBgFact.trim() || !backgroundDirty) return;
    setBgSaving(true);
    setBgEditError(null);
    try {
      const res = await fetch(`/api/org/background/${selectedBackground.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: editBgTitle,
          fact: editBgFact,
          implication: editBgImplication,
          occurredOn: editBgOccurredOn,
          tags: parseTagInput(editBgTags),
          scope: editBgScope,
          status: editBgStatus,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "更新に失敗しました");
      await refreshBackgrounds();
    } catch (err) {
      setBgEditError((err as Error).message);
    } finally {
      setBgSaving(false);
    }
  }

  async function handleRemoveBackground(id: string) {
    if (!confirm("この Standing Background を削除しますか？")) return;
    await fetch(`/api/org/background/${id}`, { method: "DELETE" });
    if (editingBackgroundId === id) setEditingBackgroundId(null);
    await refreshBackgrounds();
  }

  // docs/memo.md「H. 戦略→Issue→結果の一本線」対応。Objective/KeyResultの管理。
  // Strategy / Standing Background と同様、左ツリーは入口だけで右パネルで一覧・編集する。
  const [editingObjectiveId, setEditingObjectiveId] = useState<string | null>(null);
  const selectedObjective =
    editingObjectiveId ? objectives.find((o) => o.id === editingObjectiveId) ?? null : null;
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
  const [krDraftObjectiveId, setKrDraftObjectiveId] = useState<string | null>(null);
  const [krDraftKrIds, setKrDraftKrIds] = useState<string>("");
  const [krSavingId, setKrSavingId] = useState<string | null>(null);
  const [krEditError, setKrEditError] = useState<string | null>(null);
  const [fromOkrBusy, setFromOkrBusy] = useState(false);
  const [fromOkrError, setFromOkrError] = useState<string | null>(null);
  const [fromOkrMessage, setFromOkrMessage] = useState<string | null>(null);

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

  function selectObjectivesView() {
    setEditingObjectiveId(null);
    setEditingBackgroundId(null);
    setImportOpen(false);
    setObjectiveError(null);
    setObjectiveEditError(null);
    setKrEditError(null);
    setSelection({ kind: "objectives" });
  }

  function beginEditObjective(o: ObjectiveWithProgress) {
    setEditObjectiveTitle(o.title);
    setEditObjectiveNote(o.note ?? "");
    setEditObjectiveTeamId(o.teamId ?? "");
    setObjectiveEditError(null);
    setKrEditError(null);
    setNewKeyResultTitle("");
    setKrDrafts(Object.fromEntries(o.keyResults.map((kr) => [kr.id, kr.title])));
    setImportOpen(false);
    setEditingBackgroundId(null);
    setEditingObjectiveId(o.id);
    setSelection({ kind: "objectives" });
  }

  // objectives の初回ロード後に一度だけ適用する（ポーリングで編集中ドラフトを上書きしない）。
  if (objectivesLoaded && objectiveFocusId && objectiveFocusId !== appliedObjectiveFocusId) {
    setAppliedObjectiveFocusId(objectiveFocusId);
    const focused = objectives.find((o) => o.id === objectiveFocusId);
    if (focused) beginEditObjective(focused);
  }

  function cancelEditObjective() {
    setEditingObjectiveId(null);
    setObjectiveEditError(null);
    setKrEditError(null);
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
      setNewObjectiveTeamId("");
      await refreshObjectives();
      beginEditObjective({ ...data.objective, progress: [] });
    } catch (err) {
      setObjectiveError((err as Error).message);
    } finally {
      setObjectiveSubmitting(false);
    }
  }

  const objectiveDirty =
    !!selectedObjective &&
    (editObjectiveTitle !== selectedObjective.title ||
      editObjectiveNote !== (selectedObjective.note ?? "") ||
      editObjectiveTeamId !== (selectedObjective.teamId ?? ""));

  async function handleSaveObjective() {
    if (!selectedObjective || !editObjectiveTitle.trim() || !objectiveDirty) return;
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
      if (editingObjectiveId === id) setEditingObjectiveId(null);
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

  async function handleGenerateThemesFromOkr(objectiveId?: string) {
    setFromOkrBusy(true);
    setFromOkrError(null);
    setFromOkrMessage(null);
    try {
      const res = await fetch("/api/themes/from-okr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(objectiveId ? { objectiveIds: [objectiveId] } : {}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "テーマ候補の生成に失敗しました");
      const count = Array.isArray(data.themes) ? data.themes.length : 0;
      setFromOkrMessage(`${count}件のテーマ候補を作成しました（採用は Dashboard / 蒸留候補から）`);
      await refreshThemes();
    } catch (err) {
      setFromOkrError((err as Error).message);
    } finally {
      setFromOkrBusy(false);
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
      if (first) beginEditObjective({ ...first, progress: first.progress ?? [] });
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
  // （effect 内 setState は cascading render になるため、レンダー中に調整する）
  // selectedObjective?.id は null 時に undefined になるため、状態の null と揃えて比較する。
  const selectedObjectiveId = selectedObjective?.id ?? null;
  const selectedKrIds = selectedObjective
    ? selectedObjective.keyResults.map((kr) => kr.id).join("\0")
    : "";
  if (selectedObjectiveId !== krDraftObjectiveId || selectedKrIds !== krDraftKrIds) {
    setKrDraftObjectiveId(selectedObjectiveId);
    setKrDraftKrIds(selectedKrIds);
    if (selectedObjective) {
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
    }
  }

  return (
    <div className={`${styles.layout} ${styles.screen}`}>
      <div className={styles.panel}>
        <h2>方針・目標</h2>
        <p className={styles.subtitle}>
          組織のMVV（Strategy）、Standing Background（長期の背景事実）、OKR（Objectives）——EMが「不動の前提」としてAgent
          Runtimeへ注入する情報です。目標は組織全体からチームへとカスケードする構造で管理します（チームの追加・編集は「チーム・メンバー」タブで行います）。
        </p>

        <div className={styles.tree} style={{ marginTop: 14 }}>
          <div className={styles.treeFolder}>📁 Strategy（MVV）</div>
          <div
            className={`${styles.treeFile} ${selection?.kind === "strategy" ? styles.treeFileSelected : ""}`}
            onClick={selectStrategy}
          >
            📄 Strategy
          </div>

          <div className={styles.treeFolder} style={{ marginTop: 10 }}>📁 Standing Background</div>
          <div
            className={`${styles.treeFile} ${selection?.kind === "backgrounds" ? styles.treeFileSelected : ""}`}
            onClick={selectBackgroundsView}
          >
            📄 Standing Background
            {backgroundsLoaded && backgrounds.filter((b) => b.status === "active").length > 0
              ? `（${backgrounds.filter((b) => b.status === "active").length}件）`
              : ""}
          </div>

          <div className={styles.treeFolder} style={{ marginTop: 10 }}>📁 Objectives（OKR）</div>
          <div
            className={`${styles.treeFile} ${selection?.kind === "objectives" ? styles.treeFileSelected : ""}`}
            onClick={selectObjectivesView}
          >
            📄 Objectives
            {objectivesLoaded && objectives.length > 0 ? `（${objectives.length}件）` : ""}
          </div>
        </div>
      </div>

      <div className={styles.panel}>
        {!selection && (
          <p className={styles.emptyState}>左のツリーからStrategy・Standing Background・Objectivesを選択してください。</p>
        )}

        {selection?.kind === "strategy" && (
          <>
            <div className={styles.editorPath}>
              <button
                className={styles.primaryBtn}
                onClick={handleSaveStrategy}
                disabled={strategySaving || !strategySeeded || !strategyDirty}
              >
                {strategySaving ? "保存中…" : strategyDirty ? "保存" : "保存済み"}
              </button>
            </div>
            <p className={styles.subtitle}>
              組織全体のMVVはIssueに依らず常にAgent Runtimeへ絶対の前提として注入されます。未入力の項目は注入されません。OKRは「Objectives」で管理します。
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

        {selection?.kind === "backgrounds" && (
          <>
            <p className={styles.subtitle}>
              日々の Journal ではなく、判断を長く縛る組織の背景です。事実と含意を分けて書き、注入範囲が
              always ならほぼ全 Run に、tagged ならタグ／本文の手がかりがあるときだけ渡します（常時効くものは5〜20件程度を目安）。
            </p>

            {!selectedBackground && (
              <>
                <h3 style={{ marginTop: 4, marginBottom: 8, fontSize: "0.875rem" }}>新規追加</h3>
                <form onSubmit={handleAddBackground}>
                  <div className={styles.field}>
                    <label>見出し
                    <input
                      value={newBgTitle}
                      onChange={(e) => setNewBgTitle(e.target.value)}
                      placeholder="例: 2024 個人情報漏洩"
                      style={{ width: "100%", border: "1px solid var(--input-border)", borderRadius: 6, padding: "6px 8px" }}
                    /></label>
                  </div>
                  <div className={styles.field}>
                    <label>事実（いつ・何が起きたか）
                    <textarea rows={3} value={newBgFact} onChange={(e) => setNewBgFact(e.target.value)} /></label>
                  </div>
                  <div className={styles.field}>
                    <label>いまの判断への含意（任意）
                    <textarea
                      rows={2}
                      value={newBgImplication}
                      onChange={(e) => setNewBgImplication(e.target.value)}
                    /></label>
                  </div>
                  <div className={styles.field}>
                    <label>時期（任意・例: 2024-Q3）
                    <input
                      value={newBgOccurredOn}
                      onChange={(e) => setNewBgOccurredOn(e.target.value)}
                      style={{ width: "100%", border: "1px solid var(--input-border)", borderRadius: 6, padding: "6px 8px" }}
                    /></label>
                  </div>
                  <div className={styles.field}>
                    <label>タグ（カンマ区切り）
                    <input
                      value={newBgTags}
                      onChange={(e) => setNewBgTags(e.target.value)}
                      placeholder="security, trust"
                      style={{ width: "100%", border: "1px solid var(--input-border)", borderRadius: 6, padding: "6px 8px" }}
                    /></label>
                  </div>
                  <div className={styles.field}>
                    <Select
                      label="注入範囲"
                      value={newBgScope}
                      onChange={(v) => setNewBgScope(v as "always" | "tagged")}
                      options={[
                        { value: "always", label: "always（ほぼ全 Run）" },
                        { value: "tagged", label: "tagged（手がかりがあるときだけ）" },
                      ]}
                      style={{ width: "100%" }}
                    />
                  </div>
                  {bgError && <p className={styles.errorText} role="alert">{bgError}</p>}
                  <button
                    className={styles.primaryBtn}
                    type="submit"
                    style={{ width: "auto" }}
                    disabled={bgSubmitting || !newBgTitle.trim() || !newBgFact.trim()}
                  >
                    {bgSubmitting ? "追加中…" : "追加"}
                  </button>
                </form>

                <hr style={{ margin: "20px 0", border: 0, borderTop: "1px solid var(--input-border)" }} />

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 8 }}>
                  <h3 style={{ margin: 0, fontSize: "0.875rem" }}>一覧</h3>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.75rem", color: "var(--text-muted)" }}>
                    <input
                      type="checkbox"
                      checked={showArchivedBackgrounds}
                      onChange={(e) => setShowArchivedBackgrounds(e.target.checked)}
                    />
                    アーカイブも表示
                  </label>
                </div>
                {!backgroundsLoaded ? (
                  <p className={styles.subtitle}>読み込み中…</p>
                ) : visibleBackgrounds.length === 0 ? (
                  <p className={styles.subtitle}>まだ背景事実がありません。</p>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {visibleBackgrounds.map((b) => (
                      <button
                        key={b.id}
                        type="button"
                        onClick={() => beginEditBackground(b)}
                        style={{
                          textAlign: "left",
                          padding: "10px 12px",
                          border: "1px solid var(--input-border)",
                          borderRadius: 8,
                          background: "var(--panel-bg, transparent)",
                          cursor: "pointer",
                        }}
                      >
                        <div style={{ fontSize: "0.875rem", fontWeight: 600 }}>
                          {b.occurredOn ? `[${b.occurredOn}] ` : ""}
                          {treeTitle(b.title)}
                        </div>
                        <div style={{ marginTop: 4, fontSize: "0.75rem", color: "var(--text-muted)" }}>
                          {b.scope === "always" ? "always" : "tagged"}
                          {b.status === "archived" ? " · アーカイブ" : ""}
                          {b.tags.length > 0 ? ` · ${b.tags.join(", ")}` : ""}
                        </div>
                        <div style={{ marginTop: 6, fontSize: "0.8125rem", color: "var(--text-muted)" }}>
                          {b.fact.length > 120 ? `${b.fact.slice(0, 120)}…` : b.fact}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}

            {selectedBackground && (
              <>
                <div className={styles.editorPath}>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button type="button" className={styles.btnOutline} onClick={cancelEditBackground}>
                      一覧に戻る
                    </button>
                    <button
                      className={styles.primaryBtn}
                      style={{ width: "auto" }}
                      onClick={handleSaveBackground}
                      disabled={bgSaving || !editBgTitle.trim() || !editBgFact.trim() || !backgroundDirty}
                    >
                      {bgSaving ? "保存中…" : backgroundDirty ? "保存" : "保存済み"}
                    </button>
                    <button className={styles.btnOutline} onClick={() => handleRemoveBackground(selectedBackground.id)}>
                      削除
                    </button>
                  </div>
                </div>
                {bgEditError && <p className={styles.errorText} role="alert">{bgEditError}</p>}
                <div className={styles.field}>
                  <label>見出し
                  <input
                    value={editBgTitle}
                    onChange={(e) => setEditBgTitle(e.target.value)}
                    style={{ width: "100%", border: "1px solid var(--input-border)", borderRadius: 6, padding: "6px 8px" }}
                  /></label>
                </div>
                <div className={styles.field}>
                  <label>事実（いつ・何が起きたか）
                  <textarea rows={4} value={editBgFact} onChange={(e) => setEditBgFact(e.target.value)} /></label>
                </div>
                <div className={styles.field}>
                  <label>いまの判断への含意（任意）
                  <textarea
                    rows={3}
                    value={editBgImplication}
                    onChange={(e) => setEditBgImplication(e.target.value)}
                  /></label>
                </div>
                <div className={styles.field}>
                  <label>時期（任意・例: 2024-Q3）
                  <input
                    value={editBgOccurredOn}
                    onChange={(e) => setEditBgOccurredOn(e.target.value)}
                    style={{ width: "100%", border: "1px solid var(--input-border)", borderRadius: 6, padding: "6px 8px" }}
                  /></label>
                </div>
                <div className={styles.field}>
                  <label>タグ（カンマ区切り）
                  <input
                    value={editBgTags}
                    onChange={(e) => setEditBgTags(e.target.value)}
                    placeholder="security, trust"
                    style={{ width: "100%", border: "1px solid var(--input-border)", borderRadius: 6, padding: "6px 8px" }}
                  /></label>
                </div>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                  <div className={styles.field} style={{ flex: 1, minWidth: 160 }}>
                    <Select
                      label="注入範囲"
                      value={editBgScope}
                      onChange={(v) => setEditBgScope(v as "always" | "tagged")}
                      options={[
                        { value: "always", label: "always（ほぼ全 Run）" },
                        { value: "tagged", label: "tagged（手がかりがあるときだけ）" },
                      ]}
                    />
                  </div>
                  <div className={styles.field} style={{ flex: 1, minWidth: 140 }}>
                    <Select
                      label="状態"
                      value={editBgStatus}
                      onChange={(v) => setEditBgStatus(v as "active" | "archived")}
                      options={[
                        { value: "active", label: "active（注入する）" },
                        { value: "archived", label: "archived（注入しない）" },
                      ]}
                    />
                  </div>
                </div>
                {backgroundHistory.length > 0 && (
                  <>
                    <h3 style={{ marginTop: 20, marginBottom: 6, fontSize: "0.8125rem" }}>変更履歴</h3>
                    <ul style={{ margin: 0, paddingLeft: 18, fontSize: "0.75rem", color: "var(--text-muted)" }}>
                      {backgroundHistory.slice(0, 8).map((ev) => (
                        <li key={ev.id}>{ev.text}</li>
                      ))}
                    </ul>
                  </>
                )}
              </>
            )}
          </>
        )}

        {selection?.kind === "objectives" && (
          <>
            <p className={styles.subtitle}>
              今期の Objective / Key Result です。組織全体からチームへカスケードする構造で管理し、Agent Runtimeへ絶対の前提として注入されます。
            </p>

            {!selectedObjective && !importOpen && (
              <>
                <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className={styles.btnOutline}
                    onClick={() => {
                      setImportOpen(true);
                      setImportError(null);
                    }}
                  >
                    テキストから取り込む
                  </button>
                </div>

                <h3 style={{ marginTop: 4, marginBottom: 8, fontSize: "0.875rem" }}>新規追加</h3>
                <form onSubmit={handleAddObjective}>
                  <div className={styles.field}>
                    <label>Objective（目標）
                    <textarea
                      rows={2}
                      value={newObjectiveTitle}
                      onChange={(e) => setNewObjectiveTitle(e.target.value)}
                      placeholder="新しいObjective（改行可）"
                    /></label>
                  </div>
                  <div className={styles.field}>
                    <span className={styles.fieldCaption}>所属チーム（未指定＝組織全体）</span>
                    <Select
                      value={newObjectiveTeamId}
                      onChange={setNewObjectiveTeamId}
                      options={[{ value: "", label: "組織全体" }, ...teamOptions]}
                      label="所属チーム"
                      style={{ width: "100%" }}
                    />
                  </div>
                  {objectiveError && <p className={styles.errorText} role="alert">{objectiveError}</p>}
                  <button
                    className={styles.primaryBtn}
                    type="submit"
                    style={{ width: "auto" }}
                    disabled={objectiveSubmitting || !newObjectiveTitle.trim()}
                  >
                    {objectiveSubmitting ? "追加中…" : "追加"}
                  </button>
                </form>

                <hr style={{ margin: "20px 0", border: 0, borderTop: "1px solid var(--input-border)" }} />

                <h3 style={{ margin: "0 0 8px", fontSize: "0.875rem" }}>一覧</h3>
                {!objectivesLoaded ? (
                  <p className={styles.subtitle}>読み込み中…</p>
                ) : objectives.length === 0 ? (
                  <p className={styles.subtitle}>まだObjectiveが登録されていません。</p>
                ) : (
                  <>
                    <div style={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--text)", marginBottom: 4 }}>
                      組織全体
                    </div>
                    {orgWideObjectives.length === 0 ? (
                      <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--text-muted)" }}>登録なし</p>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {orgWideObjectives.map((o) => (
                          <ObjectiveListCard key={o.id} objective={o} onSelect={beginEditObjective} />
                        ))}
                      </div>
                    )}
                    <ObjectiveTeamListView
                      nodes={objectiveTeamTree}
                      depth={0}
                      onSelectObjective={beginEditObjective}
                    />
                  </>
                )}
              </>
            )}

            {importOpen && !selectedObjective && (
              <>
                <div className={styles.editorPath}>
                  <button
                    type="button"
                    className={styles.btnOutline}
                    onClick={() => {
                      setImportOpen(false);
                      setImportError(null);
                    }}
                  >
                    一覧に戻る
                  </button>
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
              </>
            )}

            {selectedObjective && (
              <>
                <div className={styles.editorPath}>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button type="button" className={styles.btnOutline} onClick={cancelEditObjective}>
                      一覧に戻る
                    </button>
                    <button
                      className={styles.primaryBtn}
                      style={{ width: "auto" }}
                      onClick={handleSaveObjective}
                      disabled={objectiveSaving || !editObjectiveTitle.trim() || !objectiveDirty}
                    >
                      {objectiveSaving ? "保存中…" : objectiveDirty ? "保存" : "保存済み"}
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
                  チームを指定すると、そのチームが組織の上位目標を達成するために追う下位目標として、一覧でチーム配下にネスト表示されます。
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

                <h3 style={{ marginTop: 20, marginBottom: 4, fontSize: "0.8125rem" }}>関連テーマ（EM介入の焦点）</h3>
                <p className={styles.subtitle} style={{ marginBottom: 8 }}>
                  期初は OKR から候補テーマを先に置き、週次蒸留で観測差分による修正を行います。未リンクの採用テーマは警告します。
                </p>
                {(() => {
                  const linked = themes.filter(
                    (t) =>
                      t.status !== "dismissed" &&
                      (t.objectiveIds?.includes(selectedObjective.id) ||
                        selectedObjective.keyResults.some((kr) => t.keyResultIds?.includes(kr.id))),
                  );
                  const unlinkedAdopted = themes.filter(
                    (t) => t.status === "adopted" && !(t.objectiveIds?.length || t.keyResultIds?.length),
                  );
                  return (
                    <>
                      {linked.length === 0 ? (
                        <p className={styles.subtitle}>この Objective に紐付くテーマはまだありません。</p>
                      ) : (
                        <ul style={{ margin: "0 0 8px 16px", fontSize: "0.8125rem" }}>
                          {linked.map((t) => (
                            <li key={t.id} style={{ marginBottom: 4 }}>
                              <Link
                                href={`/?theme=${encodeURIComponent(t.id)}`}
                                className={styles.tableRowLink}
                                style={{ display: "inline", width: "auto" }}
                              >
                                {t.title}
                              </Link>
                              <span className={styles.tableMuted}> · {t.status === "adopted" ? "採用中" : t.status === "candidate" ? "候補" : t.status}</span>
                              {!t.objectiveIds?.length && !t.keyResultIds?.length && (
                                <span style={{ color: "var(--warning, #b45309)" }}> · ⚠ OKR未リンク</span>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                      {unlinkedAdopted.length > 0 && (
                        <p className={styles.subtitle} style={{ color: "var(--warning, #b45309)" }}>
                          ⚠ OKR未リンクの採用テーマが {unlinkedAdopted.length} 件あります（全体）
                        </p>
                      )}
                    </>
                  );
                })()}
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                  <button
                    type="button"
                    className={styles.primaryBtn}
                    style={{ width: "auto" }}
                    disabled={fromOkrBusy}
                    onClick={() => handleGenerateThemesFromOkr(selectedObjective.id)}
                  >
                    {fromOkrBusy ? "生成中…" : "この Objective からテーマ候補を生成"}
                  </button>
                </div>
                {fromOkrError && <p className={styles.errorText} role="alert">{fromOkrError}</p>}
                {fromOkrMessage && <p className={styles.subtitle}>{fromOkrMessage}</p>}

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
          </>
        )}
      </div>
    </div>
  );
}
