import { Link } from "react-router";
import styles from "../styles/page.module.css";
import { SuggestionLink } from "./SuggestionLink";
import type { StrategyTrailNode } from "@emther/core/strategy-trail";

const KIND_ICON: Record<StrategyTrailNode["kind"], string> = {
  issue: "🗂",
  journal: "📝",
};

function hrefFor(node: StrategyTrailNode): string {
  switch (node.kind) {
    case "issue":
      return `/suggestions/${node.id}`;
    case "journal":
      return `/journal?focus=${encodeURIComponent(node.id)}`;
  }
}

/**
 * Issue › Journal の縦の接続を1本のパンくずとして見せる。
 * currentKind に一致するノードだけリンクにせず「現在地」として強調する
 * （@/lib/strategy-trailの組み立てでは種別ごとに最大1ノードしか出ないため一意に定まる）。
 */
export function StrategyTrail({
  nodes,
  currentKind,
}: {
  nodes: StrategyTrailNode[];
  currentKind: StrategyTrailNode["kind"];
}) {
  if (nodes.length === 0) return null;

  return (
    <nav className={styles.strategyTrail} aria-label="戦略のつながり">
      {nodes.map((node, i) => {
        const isCurrent = node.kind === currentKind;
        return (
          <span key={`${node.kind}:${node.id}`} className={styles.strategyTrailItem}>
            {i > 0 && (
              <span className={styles.strategyTrailSep} aria-hidden="true">
                ›
              </span>
            )}
            {isCurrent ? (
              <span className={styles.strategyTrailCurrent}>
                {KIND_ICON[node.kind]} {node.label}
              </span>
            ) : node.kind === "issue" ? (
              <SuggestionLink id={node.id} className={styles.strategyTrailLink}>
                {KIND_ICON[node.kind]} {node.label}
              </SuggestionLink>
            ) : (
              <Link to={hrefFor(node)} className={styles.strategyTrailLink}>
                {KIND_ICON[node.kind]} {node.label}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
