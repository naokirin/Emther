import { useState } from "react";
import { Link } from "react-router";
import styles from "../../styles/page.module.css";
import type { PersonEvaluationLog } from "@emther/core/types";

export function PersonEvaluationLogsSection({
  personId,
  evaluationLogs,
  evaluationLogsLoaded,
  refreshEvaluationLogs,
}: {
  personId: string;
  evaluationLogs: PersonEvaluationLog[];
  evaluationLogsLoaded: boolean;
  refreshEvaluationLogs: () => Promise<void> | void;
}) {
  const [evalSuggestBusy, setEvalSuggestBusy] = useState(false);
  const [evalBusyId, setEvalBusyId] = useState<string | null>(null);
  const [evalError, setEvalError] = useState<string | null>(null);
  const [evalMessage, setEvalMessage] = useState<string | null>(null);
  const [showPeriodBundle, setShowPeriodBundle] = useState(false);

  async function handleSuggestEvaluationLogs() {
    setEvalSuggestBusy(true);
    setEvalError(null);
    setEvalMessage(null);
    try {
      const res = await fetch(`/api/people/${personId}/evaluation-logs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "suggest-from-journal" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "仮置きに失敗しました");
      const n = Array.isArray(data.logs) ? data.logs.length : 0;
      setEvalMessage(n > 0 ? `${n}件の仮置きログを追加しました` : "新規の仮置きはありません（既存または材料不足）");
      await refreshEvaluationLogs();
    } catch (err) {
      setEvalError((err as Error).message);
    } finally {
      setEvalSuggestBusy(false);
    }
  }

  async function handleEvalStatus(logId: string, status: "confirmed" | "discarded" | "provisional") {
    setEvalBusyId(logId);
    setEvalError(null);
    try {
      const res = await fetch(`/api/people/${personId}/evaluation-logs/${logId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "更新に失敗しました");
      }
      await refreshEvaluationLogs();
    } catch (err) {
      setEvalError((err as Error).message);
    } finally {
      setEvalBusyId(null);
    }
  }

  // ユーザー指摘「懸念(polarity: concern)を確認したが対応不要だった、を示せず強調を
  // 減らせない」対応。statusの確定/破棄とは独立に、赤い「乖離・懸念」の強調だけを
  // 弱める・戻すトグル。AIが当初検出したpolarity自体は書き換えない（監査性のため）。
  async function handleEvalNoActionNeeded(logId: string, noActionNeeded: boolean) {
    setEvalBusyId(logId);
    setEvalError(null);
    try {
      const res = await fetch(`/api/people/${personId}/evaluation-logs/${logId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ noActionNeeded }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "更新に失敗しました");
      }
      await refreshEvaluationLogs();
    } catch (err) {
      setEvalError((err as Error).message);
    } finally {
      setEvalBusyId(null);
    }
  }

  function renderEvalSection(title: string, logs: PersonEvaluationLog[]) {
    const visible = logs.filter((l) => l.status !== "discarded");
    return (
      <div style={{ marginBottom: 12 }}>
        <h4 style={{ margin: "0 0 6px", fontSize: "0.875rem" }}>{title}</h4>
        {visible.length === 0 ? (
          <p className={styles.subtitle}>まだありません。</p>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {visible.map((log) => (
              <li
                key={log.id}
                style={{
                  border: "1px solid var(--input-border)",
                  borderRadius: 8,
                  padding: 10,
                  marginBottom: 8,
                  fontSize: "0.875rem",
                }}
              >
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
                  <span className={styles.tableMuted}>
                    {log.status === "provisional" ? "仮置き" : log.status === "confirmed" ? "確定" : log.status}
                  </span>
                  {log.polarity === "concern" &&
                    (log.noActionNeededAt ? (
                      <span
                        className={`${styles.tableMuted} ${styles.axisTooltip}`}
                        data-tooltip={
                          log.noActionNeededNote
                            ? `確認済み（対応不要と判断）: ${log.noActionNeededNote}`
                            : "確認済み（対応不要と判断）"
                        }
                        tabIndex={0}
                      >
                        ✓ 乖離・懸念（確認済み）
                      </span>
                    ) : (
                      <span style={{ color: "var(--warning, #b45309)" }}>乖離・懸念</span>
                    ))}
                  <span className={styles.tableMuted}>{new Date(log.createdAt).toLocaleDateString("ja-JP")}</span>
                </div>
                <p style={{ margin: "0 0 4px" }}>{log.snapshotText}</p>
                <p className={styles.subtitle} style={{ margin: "0 0 6px" }}>
                  {log.rationale}
                  {log.valueSnapshot ? ` / Values: ${log.valueSnapshot.slice(0, 80)}${log.valueSnapshot.length > 80 ? "…" : ""}` : ""}
                </p>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <Link to={`/journal?focus=${log.sourceJournalId}`} className={styles.detailToggle}>
                    根拠 Journal
                  </Link>
                  {log.polarity === "concern" &&
                    (log.noActionNeededAt ? (
                      <button
                        type="button"
                        className={styles.btnOutline}
                        disabled={evalBusyId === log.id}
                        onClick={() => handleEvalNoActionNeeded(log.id, false)}
                      >
                        確認を取り消す
                      </button>
                    ) : (
                      <button
                        type="button"
                        className={`${styles.btnOutline} ${styles.axisTooltip}`}
                        disabled={evalBusyId === log.id}
                        onClick={() => handleEvalNoActionNeeded(log.id, true)}
                        data-tooltip="確認したが対応は不要だった場合に押してください（記録自体は残ります）"
                      >
                        確認済み/対応不要とする
                      </button>
                    ))}
                  {log.status === "provisional" && (
                    <>
                      <button
                        type="button"
                        className={styles.btnOutline}
                        disabled={evalBusyId === log.id}
                        onClick={() => handleEvalStatus(log.id, "confirmed")}
                      >
                        確定
                      </button>
                      <button
                        type="button"
                        className={styles.btnOutline}
                        disabled={evalBusyId === log.id}
                        onClick={() => handleEvalStatus(log.id, "discarded")}
                      >
                        捨てる
                      </button>
                    </>
                  )}
                  {log.status === "confirmed" && (
                    <button
                      type="button"
                      className={styles.btnOutline}
                      disabled={evalBusyId === log.id}
                      onClick={() => handleEvalStatus(log.id, "provisional")}
                    >
                      仮置きに戻す
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <>
      <h3
        className={styles.axisTooltip}
        style={{ marginTop: 20, marginBottom: 4, fontSize: "0.875rem" }}
        data-tooltip="Journalから仮置き。A（成果）とB（Value）を分けて読む"
        tabIndex={0}
      >
        日常の評価ログ（目標貢献 / Value）
      </h3>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        <button
          type="button"
          className={styles.primaryBtn}
          style={{ width: "auto" }}
          disabled={evalSuggestBusy}
          onClick={handleSuggestEvaluationLogs}
        >
          {evalSuggestBusy ? "仮置き中…" : "Journal から仮置きを提案"}
        </button>
        <button type="button" className={styles.btnOutline} onClick={() => setShowPeriodBundle((v) => !v)}>
          {showPeriodBundle ? "通常表示" : "期次の束ねを見る"}
        </button>
      </div>
      {evalError && (
        <p className={styles.errorText} role="alert">
          {evalError}
        </p>
      )}
      {evalMessage && <p className={styles.subtitle}>{evalMessage}</p>}
      {!evaluationLogsLoaded ? (
        <p className={styles.subtitle}>読み込み中…</p>
      ) : showPeriodBundle ? (
        (() => {
          const outcome = evaluationLogs.filter((l) => l.lens === "outcome" && l.status !== "discarded");
          const value = evaluationLogs.filter((l) => l.lens === "value" && l.status !== "discarded");
          const missing: string[] = [];
          if (outcome.length === 0) missing.push("目標貢献ログが不足");
          if (value.length === 0) missing.push("Value 体現ログが不足");
          return (
            <div>
              {missing.length > 0 && (
                <p className={styles.subtitle} style={{ color: "var(--warning, #b45309)" }}>
                  不足: {missing.join(" / ")}
                </p>
              )}
              {renderEvalSection("A. 成果・目標貢献（束ね）", outcome)}
              {renderEvalSection("B. Value 適合（束ね）", value)}
            </div>
          );
        })()
      ) : (
        <div>
          {renderEvalSection(
            "A. 成果・目標貢献",
            evaluationLogs.filter((l) => l.lens === "outcome"),
          )}
          {renderEvalSection(
            "B. Value 適合",
            evaluationLogs.filter((l) => l.lens === "value"),
          )}
        </div>
      )}
    </>
  );
}
