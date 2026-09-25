import type { ExplorationKind } from "@emther/core/agent-runtime";

/** Explore 観点の表示ラベル（断定せず観測ギャップとして示す） */
export const EXPLORATION_KIND_LABELS: Record<ExplorationKind, string> = {
  blind_spot: "観測の偏り",
  missing_evidence: "裏付け不足",
  contradiction: "矛盾するシグナル",
  drift: "関心の消失",
  unexplored_area: "未探索領域",
};

export function explorationKindLabel(kind: ExplorationKind): string {
  return EXPLORATION_KIND_LABELS[kind] ?? kind;
}
