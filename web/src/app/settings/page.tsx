"use client";

import { useState } from "react";
import styles from "@/app/page.module.css";
import { useSettingsRules } from "@/lib/hooks";
import { AGENT_OPTIONS, CLI_LABELS, CLI_OPTIONS, MODEL_TIER_OPTIONS, type CliName, type ModelTier, type RulesAndConstraints } from "@/lib/types";

// Rules_and_Constraints（Team Vitalsの判定閾値）はOrganization Context（組織のMVVや
// 体制などの「不動の前提」）とは性質が異なり、アプリの挙動を調整する設定値なので、
// /org（Context Directory）とは分離した独立の画面として持つ。
//
// ユーザー指摘「設定がフラットに並びすぎている」対応。項目数が増えてきたため、
// 左メニューで切り替えるグループに分ける（URL遷移は伴わないページ内切り替えなので、
// TopNav.tsxのAppShellとは別に、ここだけで完結するstateで持つ）。ドラフトは1つの
// RulesAndConstraintsオブジェクトのまま（グループを切り替えても他グループの編集内容は
// 保持される）で、変わるのは表示だけ。
type SettingsGroupKey = "vitals" | "agentRun" | "aiTools" | "automation" | "morningMode";

const SETTINGS_GROUPS: { key: SettingsGroupKey; label: string }[] = [
  { key: "vitals", label: "バイタル・判定基準" },
  { key: "agentRun", label: "Agent Run運用" },
  { key: "aiTools", label: "AIツール" },
  { key: "automation", label: "自動起動" },
  { key: "morningMode", label: "Morning Mode" },
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
        {/* WCAG 2.4.6/1.3.1対応。以前はh1（layout.tsx側）から直接h3へ飛んでいた
            （見出しレベルの飛び越し）。ページの主見出しとしてh2を挟む。 */}
        <h2>Settings</h2>
        {/* ユーザー指摘「保存ボタンが右上にしかなく、押し忘れ・保存されたかの
            わかりにくさがある」対応。左メニューでどのグループを見ていても常に同じ
            場所に見える、ページ上部に固定した保存バーにする（グループ間で切り替えても
            スクロール・移動が要らない）。 */}
        <div className={styles.editorPath}>
          <code>/Settings/Rules_and_Constraints</code>
          <button className={styles.primaryBtn} onClick={handleSave} disabled={saving || !seeded || !isDirty}>
            {saving ? "保存中…" : isDirty ? "保存" : "保存済み"}
          </button>
        </div>
        {isDirty && <p className={styles.errorText} role="status">⚠️ 未保存の変更があります</p>}
        {!isDirty && savedAt !== null && (
          <p className={styles.successText} role="status">✓ {new Date(savedAt).toLocaleTimeString("ja-JP")}に保存しました</p>
        )}
        {saveError && <p className={styles.errorText} role="alert">{saveError}</p>}
        <p className={styles.subtitle}>
          Team Vitalsの判定に使う閾値・データ欠如とみなす期間です。Organization Context（組織のMVVや体制）とは異なり、
          こちらはアプリの動作を調整する設定値です。
        </p>
      </div>

      <div className={styles.appBody} style={{ marginTop: 16 }}>
        <nav className={styles.sideNav}>
          {/* ユーザー指摘「サイドメニューのデザインがほかタブと異なる」対応。他タブの
              サイドメニュー（TopNav.tsxのAppShell、相談・振り返り・チーム・メンバー等）は
              先頭に「📍 グループ名」の見出しを持つが、ここに無かったため見た目が揃って
              いなかった。同じ.sideNavHintクラスで揃える。 */}
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
                <p className={styles.subtitle} style={{ marginBottom: 8 }}>
                  着手済みの介入（Issue）がこの日数以上動いていなければ「停滞中」として一覧・朝キューに表示します。
                </p>
                <div className={styles.field} style={{ maxWidth: 160 }}>
                  <label>停滞とみなす日数
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
                <p className={styles.subtitle} style={{ marginBottom: 8 }}>
                  エージェント1体につきCLI子プロセス（claude/agy/cursor-agent）を1つ起動します。無制限に並列起動するとメモリを大量消費し環境が不安定になるため、同時に実行できる数に上限を設けます。
                  上限を超えた分は自動的にキューイングされ、順番が来ると起動します（Agent Run一覧で「⏳ Queued（順番待ち）」として確認できます）。
                </p>
                <div className={styles.field} style={{ maxWidth: 160 }}>
                  <label>同時に実行できるAgent Runの最大数
                  <input
                    type="number"
                    min={1}
                    value={draft.maxParallelAgentRuns}
                    onChange={(e) => setDraft({ ...draft, maxParallelAgentRuns: Number(e.target.value) })}
                  /></label>
                </div>

                <h3 style={{ fontSize: "0.8125rem", marginTop: 20, marginBottom: 4 }}>Agent Runの無応答検知</h3>
                <p className={styles.subtitle} style={{ marginBottom: 8 }}>
                  「動いていると思ったら止まっていた」を防ぐための閾値です。statusが稼働中のままログ更新が無い時間で判定します。
                </p>
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
                <p className={styles.subtitle} style={{ marginBottom: 8 }}>
                  一時的な発言・感情（ファクト）は、この日数を過ぎるとAgent Runtimeへの注入対象から外れます（履歴としては残り、削除はされません）。長期的な解釈・プロファイルにはTTLはありません。
                </p>
                <div className={styles.field}>
                  <label>Journalファクトの有効日数
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
                {/* ユーザー指摘「AIツールの優先度設定が増えたことでフォールバック設定との
                    競合が発生している」「エージェントごとに設定できる必要はない、全体で
                    1つで大丈夫」対応。以前は「利用するAIツールの優先順位」（全エージェント
                    共通の並び順）と「agy/Cursorフォールバック」（エージェント種別ごとの
                    ON/OFF）が別々の設定として存在し、片方だけ変えても反映されない
                    （OFFのままだから）といった混乱があった。全エージェント共通で、
                    チェックで候補に入れる/外す（＝除外）・↑↓で試す順（＝優先度）を同じ
                    1つのリストで決められるようにする。
                    ユーザー指摘「AIツール設定の先頭に持ってきておきたい」対応で、
                    エージェント種別ごとのモデル設定より前に置く。
                    ユーザー指摘「claude codeが外せないようになっている」対応で、
                    claudeも他の2つと同様に除外できるようにする（最後の1つは
                    候補ゼロを防ぐため外せない）。 */}
                <h3 style={{ fontSize: "0.8125rem", marginTop: 0, marginBottom: 4 }}>利用するAIツールの優先順位・除外</h3>
                <p className={styles.subtitle} style={{ marginBottom: 8 }}>
                  Agent Runの各ターンで、チェックした順にCLIを試します（1つ失敗したら次の候補へ進みます）。
                  チェックを外したCLIは候補から除外されます（最後の1つは候補ゼロを防ぐため外せません）。
                  agyは会話継続（`--conversation`）、Cursor CLIは会話継続（`--resume`）に対応しているため、フォールバック後も壁打ちの複数ターンを続けられます。
                  Cursor CLIはこのアプリのソース・データが見えない専用の空ディレクトリをワークスペースに指定して実行します。
                </p>
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
                <p className={styles.subtitle} style={{ marginBottom: 8 }}>
                  claude CLIが呼び出すモデルの系統をエージェント種別ごとに事前に決めておけます。モデルは日々更新されるため、
                  特定バージョンではなく系統名（sonnet/opus/fable/haiku）で指定します。「（CLIの既定のまま）」を選ぶと、
                  claude CLI自身が選ぶ既定モデルのまま動きます。
                </p>
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

                {/* ユーザー要望「エージェント種別ごとのモデル系統に関して、Cursor/agyについても
                    調整できるようにしたい」対応。claudeと違いエイリアスが無く、バージョン付きの
                    具体名でしか指定できない実機確認済みの制約があるため自由入力にする。 */}
                <h3 style={{ fontSize: "0.8125rem", marginTop: 20, marginBottom: 4 }}>エージェント種別ごとのモデル（agy）</h3>
                <p className={styles.subtitle} style={{ marginBottom: 8 }}>
                  agy（Gemini）はモデルをエイリアスではなくバージョン付きの具体名（例:
                  gemini-3.6-flash-medium）でのみ指定できます。空欄のエージェントは既定モデルのまま動きます。
                </p>
                {AGENT_OPTIONS.map((name) => (
                  <div key={name} className={styles.field} style={{ maxWidth: 260 }}>
                    <label>{name}
                    <input
                      type="text"
                      value={draft.agentAgyModels[name] ?? ""}
                      placeholder="（既定モデルのまま）"
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
                <p className={styles.subtitle} style={{ marginBottom: 8 }}>
                  Cursor CLIも同様にバージョン付きの具体名（例: gpt-5.2）でのみ指定できます。空欄のエージェントは既定モデルのまま動きます。
                </p>
                {AGENT_OPTIONS.map((name) => (
                  <div key={name} className={styles.field} style={{ maxWidth: 260 }}>
                    <label>{name}
                    <input
                      type="text"
                      value={draft.agentCursorModels[name] ?? ""}
                      placeholder="（既定モデルのまま）"
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
                <h3 style={{ fontSize: "0.8125rem", marginTop: 0, marginBottom: 4 }}>AIエージェントの自動起動（イベント駆動・バッチ駆動）</h3>
                <p className={styles.subtitle} style={{ marginBottom: 8 }}>
                  既定はどちらもOFFです。ONにすると、EMが何も指示していなくてもLead Agentが自動的に起動しコストが発生します（Human-in-the-Loopの原則上、既定を勝手に有効化することはしません）。
                  自動起動されたRunはDashboardの「次にすべきこと」に🤖マーク付きで表示され、EMが内容を確認する（または却下する）までそこに残り続けます。
                </p>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.8125rem", marginBottom: 6 }}>
                  <input
                    type="checkbox"
                    checked={draft.autoAnomalyDetectionEnabled}
                    onChange={(e) => setDraft({ ...draft, autoAnomalyDetectionEnabled: e.target.checked })}
                  />
                  Journalに緊急度highのエントリが追加されたら、Lead Agentが自動で分析しIssue化すべきか判断する
                </label>
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
              </>
            )}

            {activeGroup === "morningMode" && (
              <>
                <h3 style={{ fontSize: "0.8125rem", marginTop: 0, marginBottom: 4 }}>Morning Modeの上限件数（AI主導トリアージ）</h3>
                <p className={styles.subtitle} style={{ marginBottom: 8 }}>
                  docs/em_ui_ux_issue.md 2.2/4節対応。「今日の判断待ち」を朝の主作業にしないため、Morning Modeで前面に出す件数に上限を設けます。超過分は非表示ではなく折りたたみに回り、いつでも確認できます。
                </p>
                <div className={styles.field} style={{ maxWidth: 160 }}>
                  <label>判断待ち（decision）レーンの上限件数
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
          </div>
        </div>
      </div>
    </div>
  );
}
