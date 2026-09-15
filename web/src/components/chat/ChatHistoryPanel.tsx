"use client";

import styles from "@/app/page.module.css";
import { ConsultHistoryItem } from "@/components/ConsultHistoryItem";
import { PageTitleRow } from "@/components/HelpLink";
import type { AgentRun } from "@/components/RunDetail";

type Props = {
  historyRuns: AgentRun[];
  selectedId: string | null;
  staleRunIds: Set<string>;
  promotedRunIds: Set<string>;
  chatHistoryLoaded: boolean;
  pinError: string | null;
  onSelect: (id: string) => void;
  onNewConsult: () => void;
};

export function ChatHistoryPanel({
  historyRuns,
  selectedId,
  staleRunIds,
  promotedRunIds,
  chatHistoryLoaded,
  pinError,
  onSelect,
  onNewConsult,
}: Props) {
  return (
    <div className={styles.panel}>
      <PageTitleRow title="相談履歴" helpAnchor="chat" />
      <button className={styles.primaryBtn} onClick={onNewConsult}>
        ＋ 新しい相談を始める
      </button>
      <div className={styles.runList}>
        {historyRuns.length === 0 && (
          <p className={styles.subtitle}>{!chatHistoryLoaded ? "読み込み中…" : "まだ相談履歴はありません。"}</p>
        )}
        {pinError && (
          <p className={styles.errorText} role="alert">
            {pinError}
          </p>
        )}
        {historyRuns.map((r) => (
          <ConsultHistoryItem
            key={r.id}
            run={r}
            selected={selectedId === r.id}
            stale={staleRunIds.has(r.id)}
            promoted={promotedRunIds.has(r.id)}
            onSelect={() => onSelect(r.id)}
          />
        ))}
      </div>
    </div>
  );
}
