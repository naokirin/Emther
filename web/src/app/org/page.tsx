"use client";

import { useState } from "react";
import styles from "@/app/page.module.css";
import { useOrgStrategy, useRulesAndConstraints, useTeams } from "@/lib/hooks";
import type { OrgStrategy, RulesAndConstraints } from "@/lib/types";

type Selection = { kind: "team"; id: string } | { kind: "strategy" } | null;

export default function OrgContextPage() {
  const { teams, refreshTeams } = useTeams();
  const { strategy, refreshStrategy } = useOrgStrategy();
  const { rules, refreshRules } = useRulesAndConstraints();

  const [teamName, setTeamName] = useState("");
  const [teamMembers, setTeamMembers] = useState("");
  const [teamSubmitting, setTeamSubmitting] = useState(false);
  const [teamError, setTeamError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection>(null);

  const selectedTeam = selection?.kind === "team" ? teams.find((t) => t.id === selection.id) ?? null : null;

  const [strategyDraft, setStrategyDraft] = useState<OrgStrategy>(strategy);
  const [strategySaving, setStrategySaving] = useState(false);

  const [rulesDraft, setRulesDraft] = useState<RulesAndConstraints>(rules);
  const [rulesSaving, setRulesSaving] = useState(false);

  // ポーリングで取得したstrategy/rulesは、Strategyノードをクリックした瞬間にだけ
  // 編集用ドラフトへコピーする（effectで継続的に同期すると、EMが編集中の内容を
  // 次のポーリングが上書きしてしまうため）。
  function selectStrategy() {
    setStrategyDraft(strategy);
    setRulesDraft(rules);
    setSelection({ kind: "strategy" });
  }

  async function handleSaveStrategy() {
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

  async function handleSaveRules() {
    setRulesSaving(true);
    try {
      await fetch("/api/org/rules", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rulesDraft),
      });
      await refreshRules();
    } finally {
      setRulesSaving(false);
    }
  }

  async function handleAddTeam(e: React.FormEvent) {
    e.preventDefault();
    if (!teamName.trim()) return;
    setTeamSubmitting(true);
    setTeamError(null);
    try {
      const members = teamMembers
        .split(",")
        .map((m) => m.trim())
        .filter(Boolean);
      const res = await fetch("/api/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: teamName, members }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "チームの追加に失敗しました");
      setTeamName("");
      setTeamMembers("");
      setSelection({ kind: "team", id: data.team.id });
      await refreshTeams();
    } catch (err) {
      setTeamError((err as Error).message);
    } finally {
      setTeamSubmitting(false);
    }
  }

  async function handleRemoveTeam(id: string) {
    try {
      await fetch(`/api/teams/${id}`, { method: "DELETE" });
      if (selection?.kind === "team" && selection.id === id) setSelection(null);
      await refreshTeams();
    } catch {
      // 失敗時は次回のポーリングで状態が揃う
    }
  }

  return (
    <div className={`${styles.layout} ${styles.screen}`}>
      <div className={styles.panel}>
        <h2>Context Directory</h2>
        <p className={styles.subtitle}>チーム構成はAgent Runtimeへ絶対の前提として注入され、Team Vitalsの算出にも使われます。</p>
        <form onSubmit={handleAddTeam} style={{ marginTop: 10 }}>
          <div className={styles.field}>
            <label>チーム名</label>
            <input type="text" value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder="例: Team A" />
          </div>
          <div className={styles.field}>
            <label>メンバー（カンマ区切り）</label>
            <input
              type="text"
              value={teamMembers}
              onChange={(e) => setTeamMembers(e.target.value)}
              placeholder="例: Aさん, Bさん ※Journalのpeopleと同じ表記で"
            />
          </div>
          <button className={styles.primaryBtn} type="submit" disabled={teamSubmitting || !teamName.trim()}>
            追加
          </button>
        </form>
        {teamError && <p className={styles.errorText}>{teamError}</p>}

        <div className={styles.tree} style={{ marginTop: 14 }}>
          <div className={styles.treeFolder}>📁 Strategy（MVV / OKR / Rules）</div>
          <div
            className={`${styles.treeFile} ${selection?.kind === "strategy" ? styles.treeFileSelected : ""}`}
            onClick={selectStrategy}
          >
            📄 Strategy
          </div>

          <div className={styles.treeFolder} style={{ marginTop: 10 }}>📁 Teams（組織体制）</div>
          {teams.length === 0 && <p className={styles.subtitle}>まだチームが登録されていません。</p>}
          {teams.map((t) => (
            <div
              key={t.id}
              className={`${styles.treeFile} ${selection?.kind === "team" && selection.id === t.id ? styles.treeFileSelected : ""}`}
              onClick={() => setSelection({ kind: "team", id: t.id })}
            >
              📁 {t.name}（{t.members.length}名）
            </div>
          ))}
        </div>
      </div>

      <div className={styles.panel}>
        {!selection && <p className={styles.emptyState}>左のツリーからStrategyまたはチームを選択してください。</p>}

        {selection?.kind === "strategy" && (
          <>
            <div className={styles.editorPath}>
              <code>/Strategy</code>
              <button className={styles.primaryBtn} onClick={handleSaveStrategy} disabled={strategySaving}>
                {strategySaving ? "保存中…" : "保存"}
              </button>
            </div>
            <p className={styles.subtitle}>
              組織全体のMVVとOKRはIssueに依らず常にAgent Runtimeへ絶対の前提として注入されます。未入力の項目は注入されません。
            </p>
            <div className={styles.field}>
              <label>Mission（生む価値・存在意義）</label>
              <textarea
                rows={2}
                value={strategyDraft.mission}
                onChange={(e) => setStrategyDraft({ ...strategyDraft, mission: e.target.value })}
              />
            </div>
            <div className={styles.field}>
              <label>Vision（目指す姿）</label>
              <textarea
                rows={2}
                value={strategyDraft.vision}
                onChange={(e) => setStrategyDraft({ ...strategyDraft, vision: e.target.value })}
              />
            </div>
            <div className={styles.field}>
              <label>Values（大事にする価値観）</label>
              <textarea
                rows={2}
                value={strategyDraft.values}
                onChange={(e) => setStrategyDraft({ ...strategyDraft, values: e.target.value })}
              />
            </div>
            <div className={styles.field}>
              <label>OKR（今期の目標と主要な結果）</label>
              <textarea
                rows={3}
                value={strategyDraft.okr}
                onChange={(e) => setStrategyDraft({ ...strategyDraft, okr: e.target.value })}
              />
            </div>

            <div className={styles.editorPath} style={{ marginTop: 18 }}>
              <code>/Rules_and_Constraints</code>
              <button className={styles.primaryBtn} onClick={handleSaveRules} disabled={rulesSaving}>
                {rulesSaving ? "保存中…" : "保存"}
              </button>
            </div>
            <p className={styles.subtitle}>Team Vitalsの判定に使う閾値・データ欠如とみなす期間です。</p>
            <div className={styles.field}>
              <label>Team Vital: 判定に使う参照期間（日）</label>
              <input
                type="number"
                value={rulesDraft.teamWindowDays}
                onChange={(e) => setRulesDraft({ ...rulesDraft, teamWindowDays: Number(e.target.value) })}
              />
            </div>
            <div className={styles.field}>
              <label>Team Vital: 判定に最低限必要なジャーナル件数（未満は評価不能）</label>
              <input
                type="number"
                value={rulesDraft.minEntriesForJudgement}
                onChange={(e) => setRulesDraft({ ...rulesDraft, minEntriesForJudgement: Number(e.target.value) })}
              />
            </div>
            <div className={styles.field}>
              <label>Team Vital: 「要注意」と判定する感情スコア平均の閾値（以下でbad）</label>
              <input
                type="number"
                step="0.01"
                value={rulesDraft.teamBadSentimentMax}
                onChange={(e) => setRulesDraft({ ...rulesDraft, teamBadSentimentMax: Number(e.target.value) })}
              />
            </div>
            <div className={styles.field}>
              <label>Team Vital: 「やや注意」と判定する感情スコア平均の閾値（未満でwarn）</label>
              <input
                type="number"
                step="0.01"
                value={rulesDraft.teamWarnSentimentMax}
                onChange={(e) => setRulesDraft({ ...rulesDraft, teamWarnSentimentMax: Number(e.target.value) })}
              />
            </div>
            <div className={styles.field}>
              <label>1on1 Coverage: 判定に使う参照期間（日）</label>
              <input
                type="number"
                value={rulesDraft.coverageWindowDays}
                onChange={(e) => setRulesDraft({ ...rulesDraft, coverageWindowDays: Number(e.target.value) })}
              />
            </div>
            <div className={styles.field}>
              <label>1on1 Coverage: 「良好」と判定するカバー率（以上でgood）</label>
              <input
                type="number"
                step="0.01"
                value={rulesDraft.coverageGoodRatio}
                onChange={(e) => setRulesDraft({ ...rulesDraft, coverageGoodRatio: Number(e.target.value) })}
              />
            </div>
            <div className={styles.field}>
              <label>1on1 Coverage: 「要注意」と判定するカバー率（以上でwarn、未満でbad）</label>
              <input
                type="number"
                step="0.01"
                value={rulesDraft.coverageWarnRatio}
                onChange={(e) => setRulesDraft({ ...rulesDraft, coverageWarnRatio: Number(e.target.value) })}
              />
            </div>
          </>
        )}

        {selectedTeam && (
          <>
            <div className={styles.editorPath}>
              <code>/Teams/{selectedTeam.name}</code>
              <button className={styles.btnOutline} onClick={() => handleRemoveTeam(selectedTeam.id)}>
                このチームを削除
              </button>
            </div>
            <div className={styles.field}>
              <label>Members_Profile</label>
              <div className={styles.tagRow} style={{ marginTop: 6 }}>
                {selectedTeam.members.length === 0 && <span className={styles.subtitle}>メンバー未登録</span>}
                {selectedTeam.members.map((m) => (
                  <span key={m} className={`${styles.tag} ${styles.tagPerson}`}>
                    @{m}
                  </span>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
