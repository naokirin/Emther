import { teamPathSegments, type Team } from "@emther/core/types";

// チーム名の"/"区切り（例: "Engineering/Team A"）をパスとして解釈し
// 共通のセグメントを持つチームをネストしたフォルダとして表示するためのツリー構造
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
