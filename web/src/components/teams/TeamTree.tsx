"use client";

import styles from "@/app/page.module.css";
import { teamPathSegments, type Team } from "@/lib/types";

// docs/memo.md TODO「チームの組織階層を入力できるようにする」への対応。
// チーム名の"/"区切り（例: "Engineering/Team A"）をパスとして解釈し、
// 共通のセグメントを持つチームをネストしたフォルダとして表示するためのツリー構造。
export type TeamTreeNode = {
  segment: string;
  team?: Team;
  children: TeamTreeNode[];
};

export function buildTeamTree(teams: Team[]): TeamTreeNode[] {
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
