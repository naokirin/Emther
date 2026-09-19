"use client";

import { useState } from "react";
import styles from "@/app/page.module.css";
import { DataMigrationPanel } from "@/components/DataMigrationPanel";
import { PageTitleRow } from "@/components/HelpLink";
import { VitalsSettingsGroup } from "@/components/settings/VitalsSettingsGroup";
import { AgentRunSettingsGroup } from "@/components/settings/AgentRunSettingsGroup";
import { AiToolsSettingsGroup } from "@/components/settings/AiToolsSettingsGroup";
import { AutomationSettingsGroup } from "@/components/settings/AutomationSettingsGroup";
import { MorningModeSettingsGroup } from "@/components/settings/MorningModeSettingsGroup";
import { useSettingsRules } from "@/lib/hooks";
import type { RulesAndConstraints } from "@core/types";

// Rules_and_Constraints（Team Vitalsの判定閾値）はOrganization Context（組織のMVVや
// 体制などの「不動の前提」）とは性質が異なり、アプリの挙動を調整する設定値なので、
// /org（Context Directory）とは分離した独立の画面として持つ。
//
// ユーザー指摘「設定がフラットに並びすぎている」対応。項目数が増えてきたため、
// 左メニューで切り替えるグループに分ける（URL遷移は伴わないページ内切り替えなので、
// TopNav.tsxのAppShellとは別に、ここだけで完結するstateで持つ）。ドラフトは1つの
// RulesAndConstraintsオブジェクトのまま（グループを切り替えても他グループの編集内容は
// 保持される）で、変わるのは表示だけ。
type SettingsGroupKey = "vitals" | "agentRun" | "aiTools" | "automation" | "morningMode" | "data";

const SETTINGS_GROUPS: { key: SettingsGroupKey; label: string }[] = [
  { key: "vitals", label: "バイタル・判定基準" },
  { key: "agentRun", label: "Agent Run運用" },
  { key: "aiTools", label: "AIツール" },
  { key: "automation", label: "自動起動" },
  { key: "morningMode", label: "Morning Mode" },
  { key: "data", label: "データ" },
];

export default function SettingsPage() {
  const { rules, rulesLoaded, refreshRules } = useSettingsRules();
  const [draft, setDraft] = useState<RulesAndConstraints>(rules);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // ユーザー指摘「保存されたかのわかりにくさ」対応。直近で保存に成功した時刻を持ち、
  // 「✓ HH:MM:SSに保存しました」を表示する。draftが変わって未保存状態に戻ったら
  // （isDirtyがtrueになったら）自動的に隠れる。
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [activeGroup, setActiveGroup] = useState<SettingsGroupKey>("vitals");

  // 初回フェッチが完了した瞬間にだけ、実データでドラフトを初期化する。
  // effectではなくレンダー中に直接setStateする（Reactが公式に案内する
  // 「前回レンダーの情報を使ってstateを調整する」パターン）ことで、
  // 以後のポーリングがEM編集中の内容を上書きしないようにしている。
  const [seeded, setSeeded] = useState(false);
  if (rulesLoaded && !seeded) {
    setSeeded(true);
    setDraft(rules);
  }

  // ユーザー指摘「保存の押し忘れ」対応。サーバー側の最新値（rules）とドラフトを比較し、
  // 未保存の変更があるかを都度判定する（別途dirtyフラグを手動管理すると更新漏れの
  // リスクがあるため、値そのものの比較にする）。
  const isDirty = seeded && JSON.stringify(draft) !== JSON.stringify(rules);

  function updateDraft(patch: Partial<RulesAndConstraints>) {
    setDraft((prev) => ({ ...prev, ...patch }));
  }

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/settings/rules", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      if (!res.ok) {
        // ユーザー要望「Cursorでは、AutoはHooksの不具合のため指定できないように
        // しておいてほしい（設定しようとしたらユーザーにCursorの不具合で設定できない旨を
        // 表示）」対応。APIが返す具体的なエラー文言（selfPersonId・
        // referenceLookupCursorModel等）をそのまま表示する（無ければ既定の汎用文言）。
        const body = await res.json().catch(() => null);
        throw new Error(typeof body?.error === "string" && body.error ? body.error : "保存に失敗しました");
      }
      await refreshRules();
      setSavedAt(Date.now());
    } catch (err) {
      setSaveError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.screen}>
      <div>
        <PageTitleRow title="設定" helpAnchor="settings">
          {activeGroup !== "data" ? (
            <button
              className={styles.primaryBtn}
              style={{ width: "auto" }}
              onClick={handleSave}
              disabled={saving || !seeded || !isDirty}
            >
              {saving ? "保存中…" : isDirty ? "保存" : "保存済み"}
            </button>
          ) : null}
        </PageTitleRow>
        {activeGroup !== "data" ? (
          <>
            {isDirty && <p className={styles.errorText} role="status" style={{ marginTop: 4 }}>⚠️ 未保存の変更があります</p>}
            {!isDirty && savedAt !== null && (
              <p className={styles.successText} role="status" style={{ marginTop: 4 }}>✓ {new Date(savedAt).toLocaleTimeString("ja-JP")}に保存しました</p>
            )}
            {saveError && <p className={styles.errorText} role="alert" style={{ marginTop: 4 }}>{saveError}</p>}
          </>
        ) : null}
      </div>

      <div className={styles.appBody} style={{ marginTop: 16 }}>
        <nav className={styles.sideNav}>
          {/* 設定画面内のカテゴリ切替。グローバルなグループ内ナビは横タブに揃えたが、
              ここは同一URL内のセクション切替のため、従来の.sideNavを残す。 */}
          <div className={`${styles.sideNavHint} ${styles.axisTooltip}`} data-tooltip="設定項目のカテゴリを選ぶ" tabIndex={0}>
            📍 設定
          </div>
          {SETTINGS_GROUPS.map((g) => (
            <button
              key={g.key}
              type="button"
              className={`${styles.sideNavItem} ${styles.sideNavButton} ${activeGroup === g.key ? styles.sideNavItemActive : ""}`}
              onClick={() => setActiveGroup(g.key)}
            >
              {g.label}
            </button>
          ))}
        </nav>

        <div className={styles.appContent}>
          <div className={styles.panel}>
            {activeGroup === "vitals" && <VitalsSettingsGroup draft={draft} onChange={updateDraft} />}
            {activeGroup === "agentRun" && <AgentRunSettingsGroup draft={draft} onChange={updateDraft} />}
            {activeGroup === "aiTools" && <AiToolsSettingsGroup draft={draft} onChange={updateDraft} />}
            {activeGroup === "automation" && <AutomationSettingsGroup draft={draft} onChange={updateDraft} />}
            {activeGroup === "morningMode" && <MorningModeSettingsGroup draft={draft} onChange={updateDraft} />}
            {activeGroup === "data" && <DataMigrationPanel />}
          </div>
        </div>
      </div>
    </div>
  );
}
