"use client";

import { useState } from "react";
import styles from "@/app/page.module.css";
import { DataMigrationPanel } from "@/components/DataMigrationPanel";
import { PageTitleRow } from "@/components/HelpLink";
import { useSettingsRules } from "@/lib/hooks";
import { AGENT_OPTIONS, CLI_LABELS, CLI_OPTIONS, MODEL_TIER_OPTIONS, type CliName, type ModelTier, type RulesAndConstraints } from "@/lib/types";
import {
  LOCAL_CHAT_MODEL_PRESET_IDS,
  LOCAL_CHAT_MODEL_PRESETS,
  type LocalChatModelPresetId,
} from "@/lib/local-chat-presets";

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

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/settings/rules", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      if (!res.ok) throw new Error("保存に失敗しました");
      await refreshRules();
      setSavedAt(Date.now());
    } catch (err) {
      setSaveError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  // ユーザー指摘「AIツールの優先度設定が増えたことでフォールバック設定との競合が
  // 発生している」「エージェントごとに設定できる必要はない、全体で1つで大丈夫」対応。
  // 以前のcliPriorityOrder（全エージェント共通の並び順）+ agyFallbackAgents/
  // cursorFallbackAgents（エージェント種別ごとのON/OFF）という別々の2設定を、
  // 全エージェント共通の単一のCLI優先順位リストへ統合した。

  // チェックONで末尾（最も優先度低い）に追加、チェックOFFで除外する。claudeは
  // 無効化トグルが無い（常に含まれる）ため、ここへは渡さない。
  function toggleCli(cli: CliName, checked: boolean) {
    const current = draft.cliOrder;
    // 候補ゼロを防ぐ最後の砦（UI側のdisabledと二重）。最後の1つは外せない。
    if (!checked && current.length === 1) return;
    const next = checked ? (current.includes(cli) ? current : [...current, cli]) : current.filter((c) => c !== cli);
    setDraft({ ...draft, cliOrder: next });
  }

  function moveCli(from: number, to: number) {
    const next = [...draft.cliOrder];
    [next[from], next[to]] = [next[to], next[from]];
    setDraft({ ...draft, cliOrder: next });
  }

  return (
    <div className={styles.screen}>
      <div className={styles.panel}>
        <PageTitleRow title="設定" helpAnchor="settings" />
        {activeGroup !== "data" ? (
          <>
            <div className={styles.editorPath}>
              <button className={styles.primaryBtn} onClick={handleSave} disabled={saving || !seeded || !isDirty}>
                {saving ? "保存中…" : isDirty ? "保存" : "保存済み"}
              </button>
            </div>
            {isDirty && <p className={styles.errorText} role="status">⚠️ 未保存の変更があります</p>}
            {!isDirty && savedAt !== null && (
              <p className={styles.successText} role="status">✓ {new Date(savedAt).toLocaleTimeString("ja-JP")}に保存しました</p>
            )}
            {saveError && <p className={styles.errorText} role="alert">{saveError}</p>}
          </>
        ) : null}
      </div>

      <div className={styles.appBody} style={{ marginTop: 16 }}>
        <nav className={styles.sideNav}>
          {/* 設定画面内のカテゴリ切替。グローバルなグループ内ナビは横タブに揃えたが、
              ここは同一URL内のセクション切替のため、従来の.sideNavを残す。 */}
          <div className={styles.sideNavHint} title="設定項目のカテゴリを選ぶ">
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
            {activeGroup === "vitals" && (
              <>
                <h3 style={{ fontSize: "0.8125rem", marginTop: 0, marginBottom: 4 }}>Team Vital</h3>
                <div className={styles.field}>
                  <label>判定に使う参照期間（日）
                  <input
                    type="number"
                    value={draft.teamWindowDays}
                    onChange={(e) => setDraft({ ...draft, teamWindowDays: Number(e.target.value) })}
                  /></label>
                </div>
                <div className={styles.field}>
                  <label>判定に最低限必要なジャーナル件数（未満は評価不能）
                  <input
                    type="number"
                    value={draft.minEntriesForJudgement}
                    onChange={(e) => setDraft({ ...draft, minEntriesForJudgement: Number(e.target.value) })}
                  /></label>
                </div>
                <div className={styles.field}>
                  <label>「要注意」と判定する感情スコア平均の閾値（以下でbad）
                  <input
                    type="number"
                    step="0.01"
                    value={draft.teamBadSentimentMax}
                    onChange={(e) => setDraft({ ...draft, teamBadSentimentMax: Number(e.target.value) })}
                  /></label>
                </div>
                <div className={styles.field}>
                  <label>「やや注意」と判定する感情スコア平均の閾値（未満でwarn）
                  <input
                    type="number"
                    step="0.01"
                    value={draft.teamWarnSentimentMax}
                    onChange={(e) => setDraft({ ...draft, teamWarnSentimentMax: Number(e.target.value) })}
                  /></label>
                </div>

                <h3 style={{ fontSize: "0.8125rem", marginTop: 20, marginBottom: 4 }}>1on1 Coverage</h3>
                <div className={styles.field}>
                  <label>判定に使う参照期間（日）
                  <input
                    type="number"
                    value={draft.coverageWindowDays}
                    onChange={(e) => setDraft({ ...draft, coverageWindowDays: Number(e.target.value) })}
                  /></label>
                </div>
                <div className={styles.field}>
                  <label>「良好」と判定するカバー率（以上でgood）
                  <input
                    type="number"
                    step="0.01"
                    value={draft.coverageGoodRatio}
                    onChange={(e) => setDraft({ ...draft, coverageGoodRatio: Number(e.target.value) })}
                  /></label>
                </div>
                <div className={styles.field}>
                  <label>「要注意」と判定するカバー率（以上でwarn、未満でbad）
                  <input
                    type="number"
                    step="0.01"
                    value={draft.coverageWarnRatio}
                    onChange={(e) => setDraft({ ...draft, coverageWarnRatio: Number(e.target.value) })}
                  /></label>
                </div>

                <h3 style={{ fontSize: "0.8125rem", marginTop: 20, marginBottom: 4 }}>停滞Issue検知</h3>
                <div className={styles.field} style={{ maxWidth: 160 }}>
                  <label title="着手済みでこの日数以上動いていなければ停滞中として表示">
                    停滞とみなす日数
                  <input
                    type="number"
                    min={1}
                    value={draft.staleInterventionDays}
                    onChange={(e) => setDraft({ ...draft, staleInterventionDays: Number(e.target.value) })}
                  /></label>
                </div>
              </>
            )}

            {activeGroup === "agentRun" && (
              <>
                <h3 style={{ fontSize: "0.8125rem", marginTop: 0, marginBottom: 4 }}>Agent Runの同時実行数</h3>
                <div className={styles.field} style={{ maxWidth: 160 }}>
                  <label title="超過分はキューイングされます">
                    同時に実行できるAgent Runの最大数
                  <input
                    type="number"
                    min={1}
                    value={draft.maxParallelAgentRuns}
                    onChange={(e) => setDraft({ ...draft, maxParallelAgentRuns: Number(e.target.value) })}
                  /></label>
                </div>

                <h3 style={{ fontSize: "0.8125rem", marginTop: 20, marginBottom: 4 }}>1ターンあたりの予算上限（claude）</h3>
                <div className={styles.field} style={{ maxWidth: 160 }}>
                  <label title="Claude CLIの --max-budget-usd。agy / Cursor には非適用">
                    1ターンの上限（USD）
                  <input
                    type="number"
                    min={0.01}
                    step={0.1}
                    value={draft.perTurnBudgetUsd}
                    onChange={(e) => setDraft({ ...draft, perTurnBudgetUsd: Number(e.target.value) })}
                  /></label>
                </div>

                <h3 style={{ fontSize: "0.8125rem", marginTop: 20, marginBottom: 4 }}>Issue分析時のチーム先行並列</h3>
                <label
                  style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.8125rem", marginBottom: 6 }}
                  title="関連specialistを先に並列起動しLeadが統合。コスト増のためOFF可"
                >
                  <input
                    type="checkbox"
                    checked={draft.teamParallelKickoffEnabled}
                    onChange={(e) => setDraft({ ...draft, teamParallelKickoffEnabled: e.target.checked })}
                  />
                  関連specialistを先行並列起動し、Leadが最終判断する（既定ON）
                </label>

                <h3 style={{ fontSize: "0.8125rem", marginTop: 20, marginBottom: 4 }}>Agent Runの無応答検知</h3>
                <div className={styles.field}>
                  <label>この秒数、ログ更新が無ければ「応答なし」と表示する
                  <input
                    type="number"
                    value={draft.agentStaleAfterSeconds}
                    onChange={(e) => setDraft({ ...draft, agentStaleAfterSeconds: Number(e.target.value) })}
                  /></label>
                </div>
                <div className={styles.field}>
                  <label>この秒数を超えたらハングした子プロセスとみなし、強制終了してErrorに確定する
                  <input
                    type="number"
                    value={draft.agentKillAfterSeconds}
                    onChange={(e) => setDraft({ ...draft, agentKillAfterSeconds: Number(e.target.value) })}
                  /></label>
                </div>

                <h3 style={{ fontSize: "0.8125rem", marginTop: 20, marginBottom: 4 }}>Journalファクトの有効期間（TTL）</h3>
                <div className={styles.field}>
                  <label title="過ぎるとAgent注入対象外（履歴は残る）">
                    Journalファクトの有効日数
                  <input
                    type="number"
                    value={draft.journalFactTtlDays}
                    onChange={(e) => setDraft({ ...draft, journalFactTtlDays: Number(e.target.value) })}
                  /></label>
                </div>
              </>
            )}

            {activeGroup === "aiTools" && (
              <>
                <h3 style={{ fontSize: "0.8125rem", marginTop: 0, marginBottom: 4 }}>ローカルAI（ジャーナル抽出）</h3>
                <div className={styles.field} style={{ maxWidth: 420 }}>
                  <label title="機微情報を外部送信しないローカル推論。埋め込みモデルは対象外">
                    チャットモデルのサイズ
                    <select
                      value={draft.localChatModelPreset ?? "350m"}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          localChatModelPreset: e.target.value as LocalChatModelPresetId,
                        })
                      }
                    >
                      {LOCAL_CHAT_MODEL_PRESET_IDS.map((id) => (
                        <option key={id} value={id}>
                          {LOCAL_CHAT_MODEL_PRESETS[id].label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <p style={{ fontSize: "0.75rem", marginTop: 0, marginBottom: 16, maxWidth: 420, color: "var(--text-muted)" }}>
                  {LOCAL_CHAT_MODEL_PRESETS[draft.localChatModelPreset ?? "350m"].hint}
                  {" "}
                  保存後、未取得ならダウンロードが始まります。大きいモデルはメモリ不足でプロセスが落ちることがあります。
                </p>

                <h3 style={{ fontSize: "0.8125rem", marginTop: 0, marginBottom: 4 }}>利用するAIツールの優先順位・除外</h3>
                {(() => {
                  const order = draft.cliOrder;
                  const excluded = CLI_OPTIONS.filter((c) => !order.includes(c));
                  return (
                    <ol style={{ listStyle: "none", margin: 0, padding: 0, maxWidth: 340, marginBottom: 12 }}>
                      {order.map((cli, index) => (
                        <li key={cli} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, fontSize: "0.8125rem" }}>
                          <span style={{ width: 16, color: "var(--text-muted)" }}>{index + 1}.</span>
                          <label style={{ display: "flex", alignItems: "center", gap: 6, flex: 1 }}>
                            <input
                              type="checkbox"
                              checked
                              disabled={order.length === 1}
                              onChange={(e) => toggleCli(cli, e.target.checked)}
                            />
                            {CLI_LABELS[cli]}
                          </label>
                          <button
                            type="button"
                            className={styles.btnOutline}
                            onClick={() => moveCli(index, index - 1)}
                            disabled={index === 0}
                            aria-label={`${CLI_LABELS[cli]}を上へ`}
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            className={styles.btnOutline}
                            onClick={() => moveCli(index, index + 1)}
                            disabled={index === order.length - 1}
                            aria-label={`${CLI_LABELS[cli]}を下へ`}
                          >
                            ↓
                          </button>
                        </li>
                      ))}
                      {excluded.map((cli) => (
                        <li
                          key={cli}
                          style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, fontSize: "0.8125rem", color: "var(--text-muted)" }}
                        >
                          <span style={{ width: 16 }} />
                          <label style={{ display: "flex", alignItems: "center", gap: 6, flex: 1 }}>
                            <input type="checkbox" checked={false} onChange={(e) => toggleCli(cli, e.target.checked)} />
                            {CLI_LABELS[cli]}（除外）
                          </label>
                        </li>
                      ))}
                    </ol>
                  );
                })()}

                <h3 style={{ fontSize: "0.8125rem", marginTop: 20, marginBottom: 4 }}>エージェント種別ごとのモデル系統（claude）</h3>
                {AGENT_OPTIONS.map((name) => (
                  <div key={name} className={styles.field} style={{ maxWidth: 220 }}>
                    <label>{name}
                    <select
                      value={draft.agentModelTiers[name] ?? ""}
                      onChange={(e) => {
                        const value = e.target.value as ModelTier | "";
                        const next = { ...draft.agentModelTiers };
                        if (value) {
                          next[name] = value;
                        } else {
                          delete next[name];
                        }
                        setDraft({ ...draft, agentModelTiers: next });
                      }}
                    >
                      <option value="">（CLIの既定のまま）</option>
                      {MODEL_TIER_OPTIONS.map((tier) => (
                        <option key={tier} value={tier}>
                          {tier}
                        </option>
                      ))}
                    </select>
                    </label>
                  </div>
                ))}

                <h3 style={{ fontSize: "0.8125rem", marginTop: 20, marginBottom: 4 }}>エージェント種別ごとのモデル（agy）</h3>
                {AGENT_OPTIONS.map((name) => (
                  <div key={name} className={styles.field} style={{ maxWidth: 260 }}>
                    <label>{name}
                    <input
                      type="text"
                      value={draft.agentAgyModels[name] ?? ""}
                      placeholder="例: gemini-3.6-flash-medium（空欄＝既定）"
                      onChange={(e) => {
                        const value = e.target.value;
                        const next = { ...draft.agentAgyModels };
                        if (value.trim()) {
                          next[name] = value;
                        } else {
                          delete next[name];
                        }
                        setDraft({ ...draft, agentAgyModels: next });
                      }}
                    /></label>
                  </div>
                ))}

                <h3 style={{ fontSize: "0.8125rem", marginTop: 20, marginBottom: 4 }}>エージェント種別ごとのモデル（Cursor）</h3>
                {AGENT_OPTIONS.map((name) => (
                  <div key={name} className={styles.field} style={{ maxWidth: 260 }}>
                    <label>{name}
                    <input
                      type="text"
                      value={draft.agentCursorModels[name] ?? ""}
                      placeholder="例: gpt-5.2（空欄＝既定）"
                      onChange={(e) => {
                        const value = e.target.value;
                        const next = { ...draft.agentCursorModels };
                        if (value.trim()) {
                          next[name] = value;
                        } else {
                          delete next[name];
                        }
                        setDraft({ ...draft, agentCursorModels: next });
                      }}
                    /></label>
                  </div>
                ))}
              </>
            )}

            {activeGroup === "automation" && (
              <>
                <h3 style={{ fontSize: "0.8125rem", marginTop: 0, marginBottom: 4 }}>AIエージェントの自動起動</h3>

                <h3 style={{ fontSize: "0.8125rem", marginTop: 16, marginBottom: 4 }}>Journalの自動分析</h3>
                <label
                  style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.8125rem", marginBottom: 6 }}
                  title="投稿直後は起動しません。「この内容で確定」後に条件一致で起動"
                >
                  <input
                    type="checkbox"
                    checked={draft.autoAnomalyDetectionEnabled}
                    onChange={(e) => setDraft({ ...draft, autoAnomalyDetectionEnabled: e.target.checked })}
                  />
                  Journalを確定（校正）したとき、条件に合うエントリをLead Agentが自動分析する
                </label>
                <div className={styles.field} style={{ maxWidth: 280, opacity: draft.autoAnomalyDetectionEnabled ? 1 : 0.5 }}>
                  <label>自動起動する緊急度
                  <select
                    value={draft.autoJournalUrgencyFilter}
                    disabled={!draft.autoAnomalyDetectionEnabled}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        autoJournalUrgencyFilter: e.target.value as RulesAndConstraints["autoJournalUrgencyFilter"],
                      })
                    }
                  >
                    <option value="all">すべて</option>
                    <option value="mid_or_higher">mid以上</option>
                    <option value="high_only">highのみ</option>
                  </select></label>
                </div>
                <div className={styles.field} style={{ maxWidth: 280, opacity: draft.autoAnomalyDetectionEnabled ? 1 : 0.5 }}>
                  <label>自動起動する感情（pos/neg）
                  <select
                    value={draft.autoJournalSentimentFilter}
                    disabled={!draft.autoAnomalyDetectionEnabled}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        autoJournalSentimentFilter: e.target.value as RulesAndConstraints["autoJournalSentimentFilter"],
                      })
                    }
                  >
                    <option value="all">すべて</option>
                    <option value="negative_only">negativeのみ</option>
                  </select></label>
                </div>

                <h3 style={{ fontSize: "0.8125rem", marginTop: 16, marginBottom: 4 }}>Issue更新時の自動分析</h3>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.8125rem", marginBottom: 6 }}>
                  <input
                    type="checkbox"
                    checked={draft.autoIssueUpdateAnalysisEnabled}
                    onChange={(e) => setDraft({ ...draft, autoIssueUpdateAnalysisEnabled: e.target.checked })}
                  />
                  Why/What/Howや経過ログを更新したら、Lead Agentが自動で再分析する（同一Issueは約45秒デバウンス）
                </label>

                <h3 style={{ fontSize: "0.8125rem", marginTop: 16, marginBottom: 4 }}>朝のサマリー（バッチ）</h3>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.8125rem", marginBottom: 6 }}>
                  <input
                    type="checkbox"
                    checked={draft.autoMorningSummaryEnabled}
                    onChange={(e) => setDraft({ ...draft, autoMorningSummaryEnabled: e.target.checked })}
                  />
                  毎朝、指定時刻以降に自動で「朝のサマリー」をLead Agentに作成させる
                </label>
                <div className={styles.field} style={{ maxWidth: 160 }}>
                  <label>朝のサマリーを生成する時刻（サーバーのローカル時刻、0〜23時）
                  <input
                    type="number"
                    min={0}
                    max={23}
                    value={draft.autoMorningSummaryHour}
                    onChange={(e) => setDraft({ ...draft, autoMorningSummaryHour: Number(e.target.value) })}
                  /></label>
                </div>

                <h3 style={{ fontSize: "0.8125rem", marginTop: 16, marginBottom: 4 }}>状況の蒸留（週次バッチ）</h3>
                <label
                  style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.8125rem", marginBottom: 6 }}
                  title="候補テーマを出します。採用するまで前提には入りません"
                >
                  <input
                    type="checkbox"
                    checked={draft.autoDistillationEnabled}
                    onChange={(e) => setDraft({ ...draft, autoDistillationEnabled: e.target.checked })}
                  />
                  毎週、指定曜日・時刻以降に自動で状況蒸留を起動する
                </label>
                <div className={styles.field} style={{ maxWidth: 200, opacity: draft.autoDistillationEnabled ? 1 : 0.5 }}>
                  <label>曜日（サーバーのローカル時刻）
                  <select
                    disabled={!draft.autoDistillationEnabled}
                    value={draft.autoDistillationWeekday}
                    onChange={(e) => setDraft({ ...draft, autoDistillationWeekday: Number(e.target.value) })}
                  >
                    <option value={0}>日曜</option>
                    <option value={1}>月曜</option>
                    <option value={2}>火曜</option>
                    <option value={3}>水曜</option>
                    <option value={4}>木曜</option>
                    <option value={5}>金曜</option>
                    <option value={6}>土曜</option>
                  </select></label>
                </div>
                <div className={styles.field} style={{ maxWidth: 160, opacity: draft.autoDistillationEnabled ? 1 : 0.5 }}>
                  <label>時刻（0〜23時）
                  <input
                    type="number"
                    min={0}
                    max={23}
                    disabled={!draft.autoDistillationEnabled}
                    value={draft.autoDistillationHour}
                    onChange={(e) => setDraft({ ...draft, autoDistillationHour: Number(e.target.value) })}
                  /></label>
                </div>
              </>
            )}

            {activeGroup === "morningMode" && (
              <>
                <h3 style={{ fontSize: "0.8125rem", marginTop: 0, marginBottom: 4 }}>Morning Modeの上限件数</h3>
                <div className={styles.field} style={{ maxWidth: 160 }}>
                  <label title="超過分は「もっと見る」で追加表示">
                    判断待ち（decision）レーンの上限件数
                  <input
                    type="number"
                    min={1}
                    value={draft.decisionQueueLimit}
                    onChange={(e) => setDraft({ ...draft, decisionQueueLimit: Number(e.target.value) })}
                  /></label>
                </div>
                <div className={styles.field} style={{ maxWidth: 160 }}>
                  <label>観測不足（observation）レーンの上限件数
                  <input
                    type="number"
                    min={1}
                    value={draft.observationQueueLimit}
                    onChange={(e) => setDraft({ ...draft, observationQueueLimit: Number(e.target.value) })}
                  /></label>
                </div>
              </>
            )}
            {activeGroup === "data" && <DataMigrationPanel />}
          </div>
        </div>
      </div>
    </div>
  );
}
