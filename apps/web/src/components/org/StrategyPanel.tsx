import { useState } from "react";
import styles from "../../styles/page.module.css";
import { teamDisplayName, type OrgStrategy, type StatementElaboration, type Team } from "@emther/core/types";

type Props = {
  strategy: OrgStrategy;
  strategyLoaded: boolean;
  refreshStrategy: () => Promise<void>;
  activeTeams: Team[];
  teamsLoaded: boolean;
};

function valueItemsFromStrategy(strategy: OrgStrategy): StatementElaboration[] {
  if (strategy.valueItems && strategy.valueItems.length > 0) {
    return strategy.valueItems.map((v) => ({
      statement: v.statement,
      elaboration: v.elaboration ?? "",
    }));
  }
  if (!strategy.values.trim()) return [{ statement: "", elaboration: "" }];
  return strategy.values
    .split(/[\n,、]/)
    .map((v) => v.trim())
    .filter(Boolean)
    .map((statement) => ({ statement, elaboration: "" }));
}

export function StrategyPanel({ strategy, strategyLoaded, refreshStrategy, activeTeams, teamsLoaded }: Props) {
  const [strategyDraft, setStrategyDraft] = useState<OrgStrategy>(strategy);
  const [valueDraft, setValueDraft] = useState<StatementElaboration[]>(() => valueItemsFromStrategy(strategy));
  const [strategySaving, setStrategySaving] = useState(false);
  const [strategySeeded, setStrategySeeded] = useState(false);

  if (strategyLoaded && !strategySeeded) {
    setStrategySeeded(true);
    setStrategyDraft(strategy);
    setValueDraft(valueItemsFromStrategy(strategy));
  }

  const normalizedValues = valueDraft
    .map((v) => ({
      statement: v.statement.trim(),
      ...(v.elaboration?.trim() ? { elaboration: v.elaboration.trim() } : {}),
    }))
    .filter((v) => v.statement);

  const draftForCompare = {
    mission: strategyDraft.mission,
    missionElaboration: strategyDraft.missionElaboration?.trim() || undefined,
    vision: strategyDraft.vision,
    visionElaboration: strategyDraft.visionElaboration?.trim() || undefined,
    valueItems: normalizedValues,
  };
  const serverForCompare = {
    mission: strategy.mission,
    missionElaboration: strategy.missionElaboration?.trim() || undefined,
    vision: strategy.vision,
    visionElaboration: strategy.visionElaboration?.trim() || undefined,
    valueItems: (strategy.valueItems ?? valueItemsFromStrategy(strategy))
      .map((v) => ({
        statement: v.statement.trim(),
        ...(v.elaboration?.trim() ? { elaboration: v.elaboration.trim() } : {}),
      }))
      .filter((v) => v.statement),
  };
  const strategyDirty = strategySeeded && JSON.stringify(draftForCompare) !== JSON.stringify(serverForCompare);

  async function handleSaveStrategy() {
    if (!strategyDirty) return;
    setStrategySaving(true);
    try {
      await fetch("/api/org/strategy", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mission: strategyDraft.mission,
          missionElaboration: strategyDraft.missionElaboration ?? "",
          vision: strategyDraft.vision,
          visionElaboration: strategyDraft.visionElaboration ?? "",
          valueItems: normalizedValues,
        }),
      });
      await refreshStrategy();
    } finally {
      setStrategySaving(false);
    }
  }

  const teamsWithCharter = activeTeams
    .filter((t) => t.charter.mission.trim() || t.charter.constraints.trim())
    .sort((a, b) => teamDisplayName(a.name).localeCompare(teamDisplayName(b.name), "ja"));

  return (
    <>
      <div className={styles.editorPath}>
        <button
          className={styles.primaryBtn}
          onClick={handleSaveStrategy}
          disabled={strategySaving || !strategySeeded || !strategyDirty}
        >
          {strategySaving ? "保存中…" : strategyDirty ? "保存" : "保存済み"}
        </button>
      </div>

      <p className={styles.subtitle} style={{ marginBottom: 12 }}>
        ここには EM が日々のレンズとして使う最重要な MVV を置く（多くはプロダクト組織・自チーム）。全社など別レイヤーは
        Standing Background へ。見出しは必須相当、補足は解釈の幅を閉じる説明（メモ欄とは別）。
      </p>

      <section className={styles.orgMvvSection} aria-labelledby="mvv-mission-heading">
        <div className={styles.orgMvvSectionHead}>
          <h3 id="mvv-mission-heading" className={styles.orgMvvSectionTitle}>
            Mission
          </h3>
          <p className={styles.orgMvvSectionHint}>生む価値・存在意義</p>
        </div>
        <div className={styles.field}>
          <label>
            見出し
            <textarea
              rows={2}
              value={strategyDraft.mission}
              onChange={(e) => setStrategyDraft({ ...strategyDraft, mission: e.target.value })}
            />
          </label>
        </div>
        <div className={styles.field}>
          <label>
            補足（任意）
            <textarea
              rows={2}
              value={strategyDraft.missionElaboration ?? ""}
              onChange={(e) => setStrategyDraft({ ...strategyDraft, missionElaboration: e.target.value })}
              placeholder="解釈の幅を閉じる説明・言い換え"
            />
          </label>
        </div>
      </section>

      <section className={styles.orgMvvSection} aria-labelledby="mvv-vision-heading">
        <div className={styles.orgMvvSectionHead}>
          <h3 id="mvv-vision-heading" className={styles.orgMvvSectionTitle}>
            Vision
          </h3>
          <p className={styles.orgMvvSectionHint}>目指す姿</p>
        </div>
        <div className={styles.field}>
          <label>
            見出し
            <textarea
              rows={2}
              value={strategyDraft.vision}
              onChange={(e) => setStrategyDraft({ ...strategyDraft, vision: e.target.value })}
            />
          </label>
        </div>
        <div className={styles.field}>
          <label>
            補足（任意）
            <textarea
              rows={2}
              value={strategyDraft.visionElaboration ?? ""}
              onChange={(e) => setStrategyDraft({ ...strategyDraft, visionElaboration: e.target.value })}
            />
          </label>
        </div>
      </section>

      <section className={styles.orgMvvSection} aria-labelledby="mvv-values-heading">
        <div className={styles.orgMvvSectionHead}>
          <h3 id="mvv-values-heading" className={styles.orgMvvSectionTitle}>
            Values ×N
          </h3>
          <p className={styles.orgMvvSectionHint}>大事にする価値観（複数可）</p>
        </div>
      {valueDraft.map((item, index) => (
        <div
          key={index}
          style={{
            marginBottom: 0,
            padding: 10,
            border: "1px solid var(--input-border)",
            borderRadius: 8,
            background: "var(--panel)",
          }}
        >
          <div className={styles.field} style={{ marginBottom: 8 }}>
            <label>
              見出し
              <textarea
                rows={2}
                value={item.statement}
                onChange={(e) => {
                  const next = [...valueDraft];
                  next[index] = { ...next[index], statement: e.target.value };
                  setValueDraft(next);
                }}
              />
            </label>
          </div>
          <div className={styles.field} style={{ marginBottom: 8 }}>
            <label>
              補足（任意）
              <textarea
                rows={2}
                value={item.elaboration ?? ""}
                onChange={(e) => {
                  const next = [...valueDraft];
                  next[index] = { ...next[index], elaboration: e.target.value };
                  setValueDraft(next);
                }}
              />
            </label>
          </div>
          <button
            type="button"
            className={styles.btnOutline}
            onClick={() => setValueDraft(valueDraft.filter((_, i) => i !== index))}
            disabled={valueDraft.length <= 1}
          >
            この Value を削除
          </button>
        </div>
      ))}
      <button
        type="button"
        className={styles.btnOutline}
        onClick={() => setValueDraft([...valueDraft, { statement: "", elaboration: "" }])}
      >
        ＋ Value を追加
      </button>
      </section>

      <h3 style={{ marginTop: 20, marginBottom: 4, fontSize: "0.875rem" }}>
        チームごとの Mission・制約（参考）
      </h3>
      <p className={styles.subtitle} style={{ marginBottom: 8 }}>
        正式な二重 MVV にはしない。Mission・制約のどちらかを設定しているチームのみ（編集は「チーム」タブ）
      </p>
      {teamsWithCharter.length === 0 ? (
        <p className={styles.subtitle}>
          {!teamsLoaded ? "読み込み中…" : "Mission・制約を設定しているチームはまだありません。"}
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {teamsWithCharter.map((t) => (
            <div key={t.id} className={styles.field} style={{ margin: 0 }}>
              <span className={styles.fieldCaption}>{teamDisplayName(t.name)}</span>
              {t.charter.mission.trim() && (
                <p style={{ margin: "2px 0", fontSize: "0.875rem" }}>Mission: {t.charter.mission}</p>
              )}
              {t.charter.constraints.trim() && (
                <p style={{ margin: "2px 0", fontSize: "0.875rem", color: "var(--text-muted)" }}>
                  制約: {t.charter.constraints}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
