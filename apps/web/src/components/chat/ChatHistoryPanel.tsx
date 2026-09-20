import styles from "../../styles/page.module.css";
import { ConsultHistoryItem } from "../ConsultHistoryItem";
import { PageTitleRow } from "../HelpLink";
import type { AgentRun } from "../RunDetail";

type Props = {
  historyRuns: AgentRun[];
  selectedId: string | null;
  staleRunIds: Set<string>;
  promotedRunIds: Set<string>;
  chatHistoryLoaded: boolean;
  pinError: string | null;
  // docs/memo.md「相談、Journal、提案を削除（アーカイブ）したい」対応。
  showArchivedConsults: boolean;
  onChangeShowArchivedConsults: (value: boolean) => void;
  archivedConsultCount: number;
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
  showArchivedConsults,
  onChangeShowArchivedConsults,
  archivedConsultCount,
  onSelect,
  onNewConsult,
}: Props) {
  return (
    <div className={styles.panel}>
      <PageTitleRow title="相談履歴" helpAnchor="chat" />
      <button className={styles.primaryBtn} onClick={onNewConsult}>
        ＋ 新しい相談を始める
      </button>
      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.75rem", color: "var(--text-muted)", margin: "8px 0" }}>
        <input
          type="checkbox"
          checked={showArchivedConsults}
          onChange={(e) => onChangeShowArchivedConsults(e.target.checked)}
        />
        🗄 アーカイブ済みも表示する（{archivedConsultCount}件）
      </label>
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
