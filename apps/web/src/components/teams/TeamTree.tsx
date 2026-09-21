import styles from "../../styles/page.module.css";
import type { Team } from "@emther/core/types";
import { type TeamTreeNode } from "./buildTeamTree";

export function TeamTreeView({
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
