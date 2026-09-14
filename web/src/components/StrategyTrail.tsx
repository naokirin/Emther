"use client";

import Link from "next/link";
import styles from "@/app/page.module.css";
import type { StrategyTrailNode } from "@/lib/strategy-trail";

const KIND_ICON: Record<StrategyTrailNode["kind"], string> = {
  objective: "🎯",
  keyResult: "📈",
  issue: "🗂",
  journal: "📝",
};

function hrefFor(node: StrategyTrailNode): string {
  switch (node.kind) {
    case "objective":
      return `/org/thread?objective=${encodeURIComponent(node.id)}`;
    case "keyResult":
      return `/org/thread?objective=${encodeURIComponent(node.objectiveId)}`;
    case "issue":
      return `/issues/${node.id}`;
    case "journal":
      return `/journal?focus=${encodeURIComponent(node.id)}`;
  }
}

/**
 * Objective › KeyResult › Issue › Journal の縦の接続を1本のパンくずとして見せる。
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
            ) : (
              <Link href={hrefFor(node)} className={styles.strategyTrailLink}>
                {KIND_ICON[node.kind]} {node.label}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
