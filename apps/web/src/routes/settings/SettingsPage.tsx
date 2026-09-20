import { useState } from "react";
import styles from "../../styles/page.module.css";
import { DataMigrationPanel } from "../../components/DataMigrationPanel";
import { PageTitleRow } from "../../components/HelpLink";
import { VitalsSettingsGroup } from "../../components/settings/VitalsSettingsGroup";
import { AgentRunSettingsGroup } from "../../components/settings/AgentRunSettingsGroup";
import { AiToolsSettingsGroup } from "../../components/settings/AiToolsSettingsGroup";
import { AutomationSettingsGroup } from "../../components/settings/AutomationSettingsGroup";
import { MorningModeSettingsGroup } from "../../components/settings/MorningModeSettingsGroup";
import { useSettingsRules } from "../../lib/queries";
import type { RulesAndConstraints } from "@emther/core/types";

// web/src/app/settings/page.tsx（Next.js版）からの移植（フェーズ3.5 tier2）。
// stylesのimportパス・`@core/*`のbare specifier化以外はロジックを変更していない。
//
// **既知の暫定的な制約（データタブ）**: `DataMigrationPanel`が呼ぶ`/api/settings/data/reset`・
// `/api/settings/data/restore`は、呼び出し元プロセスを`process.exit`させる処理のため
// フェーズ4（単一プロセス配信）まで意図的にNext側にのみ実装が残っている
// （docs/2nd_architecture/plan.md フェーズ2.5高リスクバッチ8参照）。`apps/web`（Vite）の
// dev proxyは`apps/server`（Hono）にしか転送しないため、この画面を`vite dev`側で開いている
// 間は「バックアップ」は動くが「復元」「全データをリセット」は404になる
// （`next dev`側で開けば従来どおり動作する。docs/2nd_architecture/dev-hybrid-rules.md参照）。
type SettingsGroupKey = "vitals" | "agentRun" | "aiTools" | "automation" | "morningMode" | "data";

const SETTINGS_GROUPS: { key: SettingsGroupKey; label: string }[] = [
  { key: "vitals", label: "バイタル・判定基準" },
  { key: "agentRun", label: "Agent Run運用" },
  { key: "aiTools", label: "AIツール" },
  { key: "automation", label: "自動起動" },
  { key: "morningMode", label: "Morning Mode" },
  { key: "data", label: "データ" },
];

export function SettingsPage() {
  const { rules, rulesLoaded, refreshRules } = useSettingsRules();
  const [draft, setDraft] = useState<RulesAndConstraints>(rules);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [activeGroup, setActiveGroup] = useState<SettingsGroupKey>("vitals");

  // 初回フェッチが完了した瞬間にだけ、実データでドラフトを初期化する。
  const [seeded, setSeeded] = useState(false);
  if (rulesLoaded && !seeded) {
    setSeeded(true);
    setDraft(rules);
  }

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
