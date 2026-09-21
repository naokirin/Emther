import { useState } from "react";
import styles from "../styles/page.module.css";
import type { AgentRun } from "./RunDetail";
import { consultListMetaParts } from "./consultListMeta";
import { consultListSecondary, consultListTitle, truncateExcerpt } from "@emther/core/origin-trace";

const TITLE_MAX = 100;
const SECONDARY_MAX = 120;

export function ConsultHistoryItem({
  run,
  selected,
  stale,
  promoted,
  now,
  onSelect,
}: {
  run: AgentRun;
  selected: boolean;
  stale?: boolean;
  promoted?: boolean;
  now?: number;
  onSelect: () => void;
}) {
  const title = truncateExcerpt(consultListTitle(run), TITLE_MAX);
  const secondary = consultListSecondary(run);
  // Date.now()はレンダー中に直接呼ぶと不純になるため、マウント時1回だけの遅延初期化で
  // 取得する（nowプロパティで明示指定して固定できる仕組みはそのまま維持する）。
  const [mountedAt] = useState(() => Date.now());
  const isRecent = (now ?? mountedAt) - run.updatedAt < 24 * 60 * 60 * 1000;
  const metaParts = [
    ...consultListMetaParts(run, { stale, now }),
    ...(promoted ? ["提案化済み"] : []),
  ];

  return (
    <button
      id={`chat-history-${run.id}`}
      className={`${styles.runItem} ${selected ? styles.selected : ""}`}
      onClick={onSelect}
    >
      <div className={styles.runItemTitle}>
        {title}
        {isRecent && <span className={styles.newBadge}>NEW</span>}
      </div>
      {secondary && <div className={styles.runItemSecondary}>{truncateExcerpt(secondary, SECONDARY_MAX)}</div>}
      <div className={styles.runItemMeta}>
        {metaParts.map((part, i) => (
          <span key={i}>
            {i > 0 ? " · " : ""}
            {part === "未確認" ? (
              <span style={{ color: "var(--yellow-fg)", fontWeight: 600 }}>{part}</span>
            ) : (
              part
            )}
          </span>
        ))}
      </div>
    </button>
  );
}
