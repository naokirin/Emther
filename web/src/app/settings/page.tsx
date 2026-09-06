"use client";

import { useState } from "react";
import styles from "@/app/page.module.css";
import { useSettingsRules } from "@/lib/hooks";
import { AGENT_OPTIONS, type RulesAndConstraints } from "@/lib/types";

// Rules_and_Constraints（Team Vitalsの判定閾値）はOrganization Context（組織のMVVや
// 体制などの「不動の前提」）とは性質が異なり、アプリの挙動を調整する設定値なので、
// /org（Context Directory）とは分離した独立の画面として持つ。

export default function SettingsPage() {
  const { rules, rulesLoaded, refreshRules } = useSettingsRules();
  const [draft, setDraft] = useState<RulesAndConstraints>(rules);
  const [saving, setSaving] = useState(false);

  // 初回フェッチが完了した瞬間にだけ、実データでドラフトを初期化する。
  // effectではなくレンダー中に直接setStateする（Reactが公式に案内する
  // 「前回レンダーの情報を使ってstateを調整する」パターン）ことで、
  // 以後のポーリングがEM編集中の内容を上書きしないようにしている。
  const [seeded, setSeeded] = useState(false);
  if (rulesLoaded && !seeded) {
    setSeeded(true);
    setDraft(rules);
  }

  async function handleSave() {
    setSaving(true);
    try {
      await fetch("/api/settings/rules", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      await refreshRules();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={`${styles.layout} ${styles.screen}`}>
      <div className={styles.panel} style={{ gridColumn: "1 / -1" }}>
        <div className={styles.editorPath}>
          <code>/Settings/Rules_and_Constraints</code>
          <button className={styles.primaryBtn} onClick={handleSave} disabled={saving || !seeded}>
            {saving ? "保存中…" : "保存"}
          </button>
        </div>
        <p className={styles.subtitle}>
          Team Vitalsの判定に使う閾値・データ欠如とみなす期間です。Organization Context（組織のMVVや体制）とは異なり、
          こちらはアプリの動作を調整する設定値です。
        </p>
        <div className={styles.field}>
          <label>Team Vital: 判定に使う参照期間（日）</label>
          <input
            type="number"
            value={draft.teamWindowDays}
            onChange={(e) => setDraft({ ...draft, teamWindowDays: Number(e.target.value) })}
          />
        </div>
        <div className={styles.field}>
          <label>Team Vital: 判定に最低限必要なジャーナル件数（未満は評価不能）</label>
          <input
            type="number"
            value={draft.minEntriesForJudgement}
            onChange={(e) => setDraft({ ...draft, minEntriesForJudgement: Number(e.target.value) })}
          />
        </div>
        <div className={styles.field}>
          <label>Team Vital: 「要注意」と判定する感情スコア平均の閾値（以下でbad）</label>
          <input
            type="number"
            step="0.01"
            value={draft.teamBadSentimentMax}
            onChange={(e) => setDraft({ ...draft, teamBadSentimentMax: Number(e.target.value) })}
          />
        </div>
        <div className={styles.field}>
          <label>Team Vital: 「やや注意」と判定する感情スコア平均の閾値（未満でwarn）</label>
          <input
            type="number"
            step="0.01"
            value={draft.teamWarnSentimentMax}
            onChange={(e) => setDraft({ ...draft, teamWarnSentimentMax: Number(e.target.value) })}
          />
        </div>
        <div className={styles.field}>
          <label>1on1 Coverage: 判定に使う参照期間（日）</label>
          <input
            type="number"
            value={draft.coverageWindowDays}
            onChange={(e) => setDraft({ ...draft, coverageWindowDays: Number(e.target.value) })}
          />
        </div>
        <div className={styles.field}>
          <label>1on1 Coverage: 「良好」と判定するカバー率（以上でgood）</label>
          <input
            type="number"
            step="0.01"
            value={draft.coverageGoodRatio}
            onChange={(e) => setDraft({ ...draft, coverageGoodRatio: Number(e.target.value) })}
          />
        </div>
        <div className={styles.field}>
          <label>1on1 Coverage: 「要注意」と判定するカバー率（以上でwarn、未満でbad）</label>
          <input
            type="number"
            step="0.01"
            value={draft.coverageWarnRatio}
            onChange={(e) => setDraft({ ...draft, coverageWarnRatio: Number(e.target.value) })}
          />
        </div>

        <h3 style={{ fontSize: 13, marginTop: 20, marginBottom: 4 }}>Agent Runの無応答検知</h3>
        <p className={styles.subtitle} style={{ marginBottom: 8 }}>
          「動いていると思ったら止まっていた」を防ぐための閾値です。statusが稼働中のままログ更新が無い時間で判定します。
        </p>
        <div className={styles.field}>
          <label>この秒数、ログ更新が無ければ「応答なし」と表示する</label>
          <input
            type="number"
            value={draft.agentStaleAfterSeconds}
            onChange={(e) => setDraft({ ...draft, agentStaleAfterSeconds: Number(e.target.value) })}
          />
        </div>
        <div className={styles.field}>
          <label>この秒数を超えたらハングした子プロセスとみなし、強制終了してErrorに確定する</label>
          <input
            type="number"
            value={draft.agentKillAfterSeconds}
            onChange={(e) => setDraft({ ...draft, agentKillAfterSeconds: Number(e.target.value) })}
          />
        </div>

        <h3 style={{ fontSize: 13, marginTop: 20, marginBottom: 4 }}>Journalファクトの有効期間（TTL）</h3>
        <p className={styles.subtitle} style={{ marginBottom: 8 }}>
          一時的な発言・感情（ファクト）は、この日数を過ぎるとAgent Runtimeへの注入対象から外れます（履歴としては残り、削除はされません）。長期的な解釈・プロファイルにはTTLはありません。
        </p>
        <div className={styles.field}>
          <label>Journalファクトの有効日数</label>
          <input
            type="number"
            value={draft.journalFactTtlDays}
            onChange={(e) => setDraft({ ...draft, journalFactTtlDays: Number(e.target.value) })}
          />
        </div>

        <h3 style={{ fontSize: 13, marginTop: 20, marginBottom: 4 }}>Gemini CLIフォールバック</h3>
        <p className={styles.subtitle} style={{ marginBottom: 8 }}>
          claude CLIの実行が失敗した場合（起動失敗・予算/レート制限超過など）、ここでONにしたエージェント種別に限り
          gemini CLIでその1ターンを再試行します。既定は全エージェントOFF（明示的にONにしたものだけ対象）。gemini
          CLIはセッション継続（壁打ちの複数ターン）を未サポートのため、単発のタスク実行時のみ有効です。
        </p>
        {AGENT_OPTIONS.map((name) => (
          <label key={name} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, marginBottom: 6 }}>
            <input
              type="checkbox"
              checked={draft.geminiFallbackAgents.includes(name)}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  geminiFallbackAgents: e.target.checked
                    ? [...draft.geminiFallbackAgents, name]
                    : draft.geminiFallbackAgents.filter((n) => n !== name),
                })
              }
            />
            {name}
          </label>
        ))}
      </div>
    </div>
  );
}
