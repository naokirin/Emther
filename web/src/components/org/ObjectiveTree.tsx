import { teamPathSegments, type ObjectiveWithProgress, type Team } from "@/lib/types";

export function treeTitle(title: string): string {
  const first = title.split("\n")[0]?.trim() || title;
  return title.includes("\n") ? `${first}…` : first;
}

export function objectiveProgressLabel(o: ObjectiveWithProgress): string {
  const total = o.progress.reduce((sum, p) => sum + p.total, 0);
  return `KR ${o.keyResults.length}件` + (total > 0 ? ` · 提案 ${total}件` : "");
}

// docs/memo.md TODO「チームの組織階層を入力できるようにする」への対応と同じツリー構造を、
// Objectiveの表示にも流用する（チームの親子関係にそのまま乗せるため、Objective側に
// 別途parentObjectiveId等は持たせない）。
export type ObjectiveTreeNode = {
  segment: string;
  team?: Team;
  objectives: ObjectiveWithProgress[];
  children: ObjectiveTreeNode[];
};

export function buildObjectiveTeamTree(teams: Team[], objectives: ObjectiveWithProgress[]): ObjectiveTreeNode[] {
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

export function ObjectiveListCard({
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
        <div style={{ marginTop: 6, fontSize: "0.875rem", color: "var(--text-muted)" }}>
          {objective.note.length > 120 ? `${objective.note.slice(0, 120)}…` : objective.note}
        </div>
      )}
    </button>
  );
}

export function ObjectiveTeamListView({
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
              fontSize: "0.875rem",
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
