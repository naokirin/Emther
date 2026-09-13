"use client";

import { useState } from "react";
import styles from "@/app/page.module.css";
import type { OrgVitals } from "@/lib/types";

type Props = {
  vitals: OrgVitals;
  vitalsLoaded: boolean;
  onNavigateTeams: () => void;
  onPrefillJournal: (text: string) => void;
};

export function TeamStatePanel({ vitals, vitalsLoaded, onNavigateTeams, onPrefillJournal }: Props) {
  const [openVitalId, setOpenVitalId] = useState<string | null>(null);

  return (
    <div className={styles.panel}>
      <div className={styles.vitalsHead}>
        <div>
          <h2>チームの状態</h2>
          <p className={styles.subtitle}>自分が管理するチームのみ表示します。情報が足りない場合は「評価不能」と表示します。</p>
        </div>
        <div className={styles.vitalsLegend}>
          <span>🟢 安定</span>
          <span>🟡/🔴 要注意・危険</span>
          <span>⚪️ 評価不能（情報不足）</span>
        </div>
      </div>

      <div className={styles.vitalsGrid}>
        {!vitalsLoaded && <p className={styles.subtitle}>読み込み中…</p>}
        {vitalsLoaded &&
          vitals.teams.map((v) => (
            <div key={v.teamId} className={`${styles.vitalCard} ${styles[`vital-${v.status}`]}`}>
              <div className={styles.vitalLabel}>{v.teamName}</div>
              <div className={styles.vitalValue}>
                {v.status === "good" ? "🟢" : v.status === "warn" ? "🟡" : v.status === "bad" ? "🔴" : "⚪️"} {v.label}
              </div>
              <button
                className={`${styles.detailToggle} ${styles.detailToggleButton}`}
                onClick={() => setOpenVitalId(openVitalId === v.teamId ? null : v.teamId)}
              >
                根拠を見る
              </button>
              {openVitalId === v.teamId && <div className={styles.vitalDetail}>{v.reason}</div>}
              {v.status === "unknown" && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                  <button className={styles.btnOutline} onClick={() => onPrefillJournal("")}>
                    Quick Journalにメモする
                  </button>
                  {/* ユーザー要望「部下以外の人の1on1実施は基本的に扱わない」対応。
                      自分が管理するチーム(managedByEm)でなければこの提案は出さない。 */}
                  {v.managedByEm && v.members.length > 0 && (
                    <button className={styles.btnOutline} onClick={() => onPrefillJournal(`#1on1 @${v.members[0]} `)}>
                      {v.members[0]}の1on1を記録
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}

        {vitalsLoaded && (
          <div className={`${styles.vitalCard} ${styles[`vital-${vitals.oneOnOneCoverage.status}`]}`}>
            <div className={styles.vitalLabel}>1on1 Coverage (30日)</div>
            <div className={styles.vitalValue}>
              {vitals.oneOnOneCoverage.covered} / {vitals.oneOnOneCoverage.total}
            </div>
            <button
              className={`${styles.detailToggle} ${styles.detailToggleButton}`}
              onClick={() => setOpenVitalId(openVitalId === "coverage" ? null : "coverage")}
            >
              根拠を見る
            </button>
            {openVitalId === "coverage" && <div className={styles.vitalDetail}>{vitals.oneOnOneCoverage.reason}</div>}
            {(vitals.oneOnOneCoverage.status === "warn" || vitals.oneOnOneCoverage.status === "bad") &&
              vitals.oneOnOneCoverage.uncoveredMembers.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                  {vitals.oneOnOneCoverage.uncoveredMembers.slice(0, 3).map((name) => (
                    <button key={name} className={styles.btnOutline} onClick={() => onPrefillJournal(`#1on1 @${name} `)}>
                      {name}の1on1を記録
                    </button>
                  ))}
                </div>
              )}
          </div>
        )}

        {vitalsLoaded && vitals.teams.length === 0 && (
          <p className={styles.subtitle}>
            自分が管理するチームがありません。
            <button className={styles.detailToggle} onClick={onNavigateTeams}>
              チームで設定
            </button>
          </p>
        )}
      </div>
    </div>
  );
}
