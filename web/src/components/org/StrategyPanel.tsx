"use client";

import { useState } from "react";
import styles from "@/app/page.module.css";
import { teamDisplayName, type OrgStrategy, type Team } from "@/lib/types";

type Props = {
  strategy: OrgStrategy;
  strategyLoaded: boolean;
  refreshStrategy: () => Promise<void>;
  activeTeams: Team[];
  teamsLoaded: boolean;
};

export function StrategyPanel({ strategy, strategyLoaded, refreshStrategy, activeTeams, teamsLoaded }: Props) {
  const [strategyDraft, setStrategyDraft] = useState<OrgStrategy>(strategy);
  const [strategySaving, setStrategySaving] = useState(false);

  // SettingsのrulesLoaded/seededと同じ。初回フェッチ完了前の空fallbackを
  // 編集ドラフトに載せない（未入力のまま保存する事故を防ぐ）。
  const [strategySeeded, setStrategySeeded] = useState(false);
  if (strategyLoaded && !strategySeeded) {
    setStrategySeeded(true);
    setStrategyDraft(strategy);
  }

  // SettingsのisDirtyと同じ。未変更のまま保存できて「保存されたかわからない」状態に
  // ならないよう、サーバー最新値とドラフトを比較する。
  const strategyDirty = strategySeeded && JSON.stringify(strategyDraft) !== JSON.stringify(strategy);

  async function handleSaveStrategy() {
    if (!strategyDirty) return;
    setStrategySaving(true);
    try {
      await fetch("/api/org/strategy", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(strategyDraft),
      });
      await refreshStrategy();
    } finally {
      setStrategySaving(false);
    }
  }

  // ユーザー指摘「目標のカスケーディング」対応。MVVもTeam.charterというチーム単位の
  // Mission/制約を既に持っているため、組織MVVの下に参考として並べる（編集はチーム・メンバー
  // タブで行う——ここでの二重編集導線は作らない）。未設定のチームは載せない。
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
      <div className={styles.field}>
        <label>Mission（生む価値・存在意義）
        <textarea
          rows={2}
          value={strategyDraft.mission}
          onChange={(e) => setStrategyDraft({ ...strategyDraft, mission: e.target.value })}
        /></label>
      </div>
      <div className={styles.field}>
        <label>Vision（目指す姿）
        <textarea
          rows={2}
          value={strategyDraft.vision}
          onChange={(e) => setStrategyDraft({ ...strategyDraft, vision: e.target.value })}
        /></label>
      </div>
      <div className={styles.field}>
        <label>Values（大事にする価値観）
        <textarea
          rows={2}
          value={strategyDraft.values}
          onChange={(e) => setStrategyDraft({ ...strategyDraft, values: e.target.value })}
        /></label>
      </div>

      <h3 style={{ marginTop: 20, marginBottom: 4, fontSize: "0.875rem" }}>
        チームごとの Mission・制約（参考）
      </h3>
      <p className={styles.subtitle} style={{ marginBottom: 8 }}>
        Mission・制約のどちらかを設定しているチームのみ（編集は「チーム」タブ）
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
