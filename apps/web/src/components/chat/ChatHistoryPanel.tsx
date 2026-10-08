import styles from "../../styles/page.module.css";
import { ConsultHistoryItem } from "../ConsultHistoryItem";
import { PageTitleRow } from "../HelpLink";
import type { AgentRun } from "@emther/core/agent-runtime";
import { CONSULT_ORIGIN_FILTERS, type ConsultOriginFilter } from "@/router";
import { CONSULT_ORIGIN_FILTER_LABELS } from "./consultOriginFilter";

export type ChatPanelTab = "history" | "draft";

type Props = {
  historyRuns: AgentRun[];
  selectedId: string | null;
  staleRunIds: Set<string>;
  promotedRunIds: Set<string>;
  chatHistoryLoaded: boolean;
  pinError: string | null;
  showArchivedConsults: boolean;
  onChangeShowArchivedConsults: (value: boolean) => void;
  archivedConsultCount: number;
  panelTab: ChatPanelTab;
  onChangePanelTab: (tab: ChatPanelTab) => void;
  draftCount: number;
  originFilter: ConsultOriginFilter;
  onChangeOriginFilter: (filter: ConsultOriginFilter) => void;
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
  panelTab,
  onChangePanelTab,
  draftCount,
  originFilter,
  onChangeOriginFilter,
  onSelect,
  onNewConsult,
}: Props) {
  const emptyHistory =
    panelTab === "draft"
      ? "起票待ちのドラフトはありません。"
      : "この種別の相談履歴はありません。";

  return (
    <div className={styles.panel}>
      <PageTitleRow title="相談" helpAnchor="chat" />
      <button className={styles.primaryBtn} onClick={onNewConsult}>
        ＋ 新しい相談を始める
      </button>

      <div className={styles.tabs} style={{ margin: "10px 0 8px" }} role="tablist" aria-label="相談一覧の種別">
        <button
          type="button"
          role="tab"
          aria-selected={panelTab === "history"}
          className={`${styles.tabBtn} ${panelTab === "history" ? styles.tabBtnActive : ""}`}
          onClick={() => onChangePanelTab("history")}
        >
          相談履歴
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={panelTab === "draft"}
          className={`${styles.tabBtn} ${panelTab === "draft" ? styles.tabBtnActive : ""}`}
          onClick={() => onChangePanelTab("draft")}
        >
          {draftCount > 0 ? `Draft（${draftCount}）` : "Draft"}
        </button>
      </div>

      {panelTab === "history" && (
        <>
          <div className={styles.field} style={{ marginBottom: 8 }}>
            <label style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
              種別
              <select
                value={originFilter}
                onChange={(e) => onChangeOriginFilter(e.target.value as ConsultOriginFilter)}
                style={{ display: "block", width: "100%", marginTop: 4 }}
              >
                {CONSULT_ORIGIN_FILTERS.map((key) => (
                  <option key={key} value={key}>
                    {CONSULT_ORIGIN_FILTER_LABELS[key]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.75rem", color: "var(--text-muted)", margin: "0 0 8px" }}>
            <input
              type="checkbox"
              checked={showArchivedConsults}
              onChange={(e) => onChangeShowArchivedConsults(e.target.checked)}
            />
            🗄 アーカイブ済みも表示する（{archivedConsultCount}件）
          </label>
        </>
      )}

      {panelTab === "draft" && (
        <p className={styles.subtitle} style={{ margin: "0 0 8px" }}>
          起票待ちのドラフト提案です。確認して提案として残すか、様子見・却下できます。
        </p>
      )}

      <div className={styles.runList}>
        {historyRuns.length === 0 && (
          <p className={styles.subtitle}>{!chatHistoryLoaded ? "読み込み中…" : emptyHistory}</p>
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
