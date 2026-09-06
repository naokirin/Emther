"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./page.module.css";
import { STATUS_META, StatusBadge, type AgentRun, type AgentStatus } from "@/components/RunDetail";
import { PaginationControls, usePagination } from "@/components/Pagination";
import { useIssues, useJournal, useRuns, useSettingsRules, useVitals } from "@/lib/hooks";
import { AGENT_OPTIONS, URGENCY_LABEL, charterFilledCount, isRunStale, type Issue } from "@/lib/types";

const JOURNAL_PAGE_SIZE = 5;
const INBOX_PAGE_SIZE = 5;
const NEXT_ACTIONS_LIMIT = 6;

// docs/memo.md TODO「ダッシュボードで『人間のEMが次になにをするべきか？』がすぐに分かり、
// 詳細に遷移できる状態にする」への対応。Yield/Error/Issue charter未整理/Team Vitals不調という
// 既存の4つのシグナルを、EMが今すぐ対応すべき順（urgent→warn）に束ねて1箇所に見せる。
// 「対応不要」も明示できるよう、0件のときは空のリストにする（評価不能に寄せず、単に「無い」と示す）。
type NextAction = {
  id: string;
  severity: "urgent" | "warn";
  icon: string;
  text: string;
  onSelect: () => void;
};

// docs 3.1「Agent Statusシグナル」: エージェント種別ごとに直近のrunを代表値として見せる。
// そのエージェント種別のrunが一つも無い場合は「⚪️ Idle（一度も起動していない）」として扱う。
function latestRunForAgent(agentName: string, runs: AgentRun[]): AgentRun | undefined {
  const relevant = runs.filter((r) => r.agentName === agentName);
  if (relevant.length === 0) return undefined;
  return relevant.reduce((a, b) => (a.updatedAt > b.updatedAt ? a : b));
}

const STALE_META = { icon: "❔", label: "応答なし（無応答）", cls: styles.stale };

function issueNeedsCharter(issue: Issue): boolean {
  return !issue.parentId && !issue.archived && charterFilledCount(issue.charter) < 3;
}

// docs/memo.md TODO「人間EMからのインプットパターン（始業時・随時・終業時など）を設計して
// ダッシュボードに組み込む」対応。docs/first_impressionが想定する朝/日中/終業時の3フェーズを、
// 新しいデータモデルは増やさず、現在時刻に応じた案内文（軽量なバナー）としてのみ表現する。
// 時刻はクライアント（EMのブラウザ）のローカル時刻を使う。
type DayPhase = "morning" | "midday" | "evening";

function getDayPhase(hour: number): DayPhase {
  if (hour < 11) return "morning";
  if (hour < 17) return "midday";
  return "evening";
}

const DAY_PHASE_GUIDANCE: Record<DayPhase, { icon: string; text: string; cta?: string }> = {
  morning: {
    icon: "🌅",
    text: "朝のチェック: 夜間に止まっていたRunがないか、上の「次にすべきこと」とAgent Fleetの状態を確認しましょう。",
  },
  midday: {
    icon: "🕐",
    text: "随時: 気になる出来事があれば、その場でQuick Journalに記録しておくと後で役立ちます。",
    cta: "Quick Journalへ",
  },
  evening: {
    icon: "🌆",
    text: "終業前の振り返り: 今日あった出来事をQuick Journalにまとめて記録しておきましょう。",
    cta: "Quick Journalへ",
  },
};

export default function DashboardPage() {
  const router = useRouter();
  const { runs, refreshRuns } = useRuns();
  const { issues } = useIssues();
  const { vitals } = useVitals();
  const { journalEntries, setJournalEntries } = useJournal();
  const { rules } = useSettingsRules();

  // docs/memo.md TODO「動いていると思ったら止まっていた、を防ぐ」対応。statusが"active"のまま
  // ログ更新が閾値以上無いrunをクライアント側で判定し、Fleet/Next Actions/Inboxで警告表示する。
  const staleRunIds = new Set(
    runs.filter((r) => isRunStale(r.status, r.updatedAt, rules.agentStaleAfterSeconds)).map((r) => r.id),
  );

  const [agentName, setAgentName] = useState(AGENT_OPTIONS[0]);
  const [task, setTask] = useState("");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [journalText, setJournalText] = useState("");
  const [journalSubmitting, setJournalSubmitting] = useState(false);
  const [journalError, setJournalError] = useState<string | null>(null);

  // docs/memo.md「H: 永続化データモデルの設計」対応。Quick Journal（一時的なfact）とは
  // 別に、長期的な解釈（interpretation、TTLなし）を記録する口。「Aさんはリーダー志向がある」
  // のような、一時的な感情と混同すべきでない長期プロファイルはこちらに書く。
  const [profilePerson, setProfilePerson] = useState("");
  const [profileText, setProfileText] = useState("");
  const [profileSubmitting, setProfileSubmitting] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSaved, setProfileSaved] = useState(false);

  // docs/memo.md TODO「人から『〇〇の指示があった』などをもとにその人の志向性、認知傾向、
  // パーソナリティを整理する」対応。新規の推論ロジックは作らず、People Agentに
  // 「この人物についてこれまでのファクトから傾向を整理して」という通常のタスクを投げるだけ。
  // タスク文に対象者の名前が含まれることで、既存のbuildJournalContextBlock（完全一致＋
  // 意味的検索）がその人物のファクト・既存の解釈を自動的に注入してくれる。
  // 結果はあくまで下書きとして長期プロファイルの入力欄に流し込み、EMが確認・編集して
  // 「記録」を押すまでは保存しない（＝観測事実からの推測であることを常に人が確認する）。
  const [draftRunId, setDraftRunId] = useState<string | null>(null);
  const [consumedDraftRunId, setConsumedDraftRunId] = useState<string | null>(null);
  const [draftStarting, setDraftStarting] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);

  const draftRun = draftRunId ? runs.find((r) => r.id === draftRunId) ?? null : null;
  if (draftRun && draftRunId && draftRunId !== consumedDraftRunId && draftRun.status !== "active") {
    setConsumedDraftRunId(draftRunId);
    if (draftRun.status === "idle") {
      setProfileText(draftRun.proposal?.conclusion ?? "");
    } else {
      setDraftError(
        draftRun.status === "yield"
          ? "AIから追加の確認が必要という応答がありました。「何でも相談」から続きを確認してください。"
          : "下書きの生成中にエラーが発生しました。「何でも相談」からログを確認してください。",
      );
    }
  }

  async function handleDraftProfile() {
    if (!profilePerson.trim()) return;
    setDraftStarting(true);
    setDraftError(null);
    try {
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentName: "People Agent",
          task: `${profilePerson}について、これまで観測されたJournalのファクト・既存の解釈をもとに、志向性・認知傾向・パーソナリティの傾向を2〜3文程度で整理してください。断定は避け、あくまで観測された事実からの推測であることを明記してください。`,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "下書きの生成に失敗しました");
      setDraftRunId(data.run.id);
      setConsumedDraftRunId(null);
      await refreshRuns();
    } catch (err) {
      setDraftError((err as Error).message);
    } finally {
      setDraftStarting(false);
    }
  }

  async function handleProfileSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!profilePerson.trim() || !profileText.trim()) return;
    setProfileSubmitting(true);
    setProfileError(null);
    setProfileSaved(false);
    try {
      const res = await fetch("/api/knowledge/interpretations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ person: profilePerson, text: profileText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "記録に失敗しました");
      setProfileText("");
      setProfileSaved(true);
    } catch (err) {
      setProfileError((err as Error).message);
    } finally {
      setProfileSubmitting(false);
    }
  }

  const [openVitalId, setOpenVitalId] = useState<string | null>(null);

  // docs/memo.md TODO「リストにおける、フィルタ機能の拡充、ページネーションの追加を行う」への対応。
  const [statusFilter, setStatusFilter] = useState<AgentStatus | "">("");
  const filteredRuns = statusFilter ? runs.filter((r) => r.status === statusFilter) : runs;
  const journalPagination = usePagination(journalEntries, JOURNAL_PAGE_SIZE);
  const inboxPagination = usePagination(filteredRuns, INBOX_PAGE_SIZE);

  async function handleJournalSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!journalText.trim()) return;
    setJournalSubmitting(true);
    setJournalError(null);
    try {
      const res = await fetch("/api/journal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: journalText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "タグ付けに失敗しました");
      setJournalEntries([data.entry, ...journalEntries]);
      setJournalText("");
    } catch (err) {
      setJournalError((err as Error).message);
    } finally {
      setJournalSubmitting(false);
    }
  }

  async function handleStart(e: React.FormEvent) {
    e.preventDefault();
    if (!task.trim()) return;
    setStarting(true);
    setError(null);
    try {
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentName, task }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "起動に失敗しました");
      setTask("");
      await refreshRuns();
      await goToRunIssue(data.run);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setStarting(false);
    }
  }

  // Inboxのrunをクリックしたら、既にIssue化されていればそのIssueへ、
  // まだならその場でIssue化してから遷移する（Issue Workspaceは「Issueの詳細」を
  // 表示する画面として一本化しているため）。
  async function goToRunIssue(run: AgentRun) {
    const existing = issues.find((i) => i.agentRunId === run.id);
    if (existing) {
      router.push(`/issues/${existing.id}`);
      return;
    }
    try {
      const res = await fetch("/api/issues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: run.task.slice(0, 60), agentRunId: run.id }),
      });
      const data = await res.json();
      if (res.ok) router.push(`/issues/${data.issue.id}`);
    } catch {
      // 失敗時はIssue一覧から手動で紐づけられる
    }
  }

  const nextActions: NextAction[] = [];

  for (const run of runs) {
    // AI主導（イベント駆動・バッチ駆動、docs/first_implession 3.6/3.7）で自動起動されたrunは、
    // EMがまだ内容を確認していない（reviewed=false）間はstatusに関わらず必ずここに残す
    // （idleで完結していても「対応不要」と見なさない——見て見ぬふりを防ぐ）。クリック先も
    // 通常のgoToRunIssue（即Issue化）ではなく、EMが中身を見てからIssue化/却下を選べる
    // /chatへ寄せる。
    const isUnreviewedAuto = run.origin !== "manual" && !run.reviewed;
    const autoLabel = run.origin === "auto-anomaly" ? "AIが異常を検知" : "朝のサマリー";
    const onSelectAuto = () => router.push(`/chat?runId=${run.id}`);

    if (staleRunIds.has(run.id)) {
      const minutes = Math.round((Date.now() - run.updatedAt) / 60000);
      nextActions.push({
        id: `stale-${run.id}`,
        severity: "urgent",
        icon: "❔",
        text: `${run.agentName}が${minutes}分応答していません（動いているように見えて止まっている可能性）: ${run.task.slice(0, 30)}`,
        onSelect: isUnreviewedAuto ? onSelectAuto : () => goToRunIssue(run),
      });
    } else if (run.status === "yield") {
      nextActions.push({
        id: `yield-${run.id}`,
        severity: "urgent",
        icon: "🟡",
        text: `${isUnreviewedAuto ? `${autoLabel}: ` : `${run.agentName}が判断待ちです: `}${(run.yieldRequest?.reason ?? run.task).slice(0, 44)}`,
        onSelect: isUnreviewedAuto ? onSelectAuto : () => goToRunIssue(run),
      });
    } else if (run.status === "error") {
      nextActions.push({
        id: `error-${run.id}`,
        severity: "urgent",
        icon: "🔴",
        text: `${isUnreviewedAuto ? `${autoLabel}（エラー）: ` : `${run.agentName}でエラーが発生しました: `}${run.task.slice(0, 44)}`,
        onSelect: isUnreviewedAuto ? onSelectAuto : () => goToRunIssue(run),
      });
    } else if (isUnreviewedAuto && run.status === "idle") {
      nextActions.push({
        id: `auto-${run.id}`,
        severity: "warn",
        icon: "🤖",
        text: `${autoLabel}: ${run.task.slice(0, 44)}`,
        onSelect: onSelectAuto,
      });
    }
  }

  for (const issue of issues) {
    if (!issueNeedsCharter(issue)) continue;
    nextActions.push({
      id: `charter-${issue.id}`,
      severity: "warn",
      icon: "❓",
      text: `Issue「${issue.title}」のWhy/What/Howが${charterFilledCount(issue.charter)}/3しか整理されていません`,
      onSelect: () => router.push(`/issues/${issue.id}`),
    });
  }

  for (const v of vitals.teams) {
    if (v.status === "bad" || v.status === "warn") {
      nextActions.push({
        id: `vital-${v.teamId}`,
        severity: v.status === "bad" ? "urgent" : "warn",
        icon: v.status === "bad" ? "🔴" : "🟡",
        text: `${v.teamName}のチーム状態: ${v.label}`,
        onSelect: () => router.push("/org"),
      });
    }
  }

  if (vitals.oneOnOneCoverage.status === "bad" || vitals.oneOnOneCoverage.status === "warn") {
    nextActions.push({
      id: "coverage",
      severity: vitals.oneOnOneCoverage.status === "bad" ? "urgent" : "warn",
      icon: vitals.oneOnOneCoverage.status === "bad" ? "🔴" : "🟡",
      text: `1on1 Coverageが${vitals.oneOnOneCoverage.covered}/${vitals.oneOnOneCoverage.total}件です`,
      onSelect: () => router.push("/org"),
    });
  }

  nextActions.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "urgent" ? -1 : 1));

  const dayPhase = getDayPhase(new Date().getHours());
  const guidance = DAY_PHASE_GUIDANCE[dayPhase];

  function focusJournalInput() {
    const el = document.getElementById("quick-journal-input");
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    (el as HTMLInputElement | null)?.focus();
  }

  return (
    <div className={styles.screen}>
      <div
        className={styles.panel}
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "10px 16px" }}
      >
        <span style={{ fontSize: 13 }}>
          {guidance.icon} {guidance.text}
        </span>
        {guidance.cta && (
          <button className={styles.btnOutline} style={{ flexShrink: 0 }} onClick={focusJournalInput}>
            {guidance.cta}
          </button>
        )}
      </div>

      <div className={`${styles.panel} ${styles.nextActionsPanel}`}>
        <h2>次にすべきこと</h2>
        <p className={styles.subtitle}>
          判断待ち・エラー・未整理のIssue・要注意のチーム状態をまとめています。クリックで詳細に移動できます。
        </p>
        {nextActions.length === 0 ? (
          <p className={styles.subtitle}>✅ 特に対応が必要な項目はありません。</p>
        ) : (
          <>
            <div className={styles.runList} style={{ maxHeight: "none" }}>
              {nextActions.slice(0, NEXT_ACTIONS_LIMIT).map((a) => (
                <button
                  key={a.id}
                  className={`${styles.runItem} ${a.severity === "urgent" ? styles.nextActionUrgent : styles.nextActionWarn}`}
                  onClick={a.onSelect}
                >
                  <div>
                    {a.icon} {a.text}
                  </div>
                </button>
              ))}
            </div>
            {nextActions.length > NEXT_ACTIONS_LIMIT && (
              <p className={styles.subtitle} style={{ marginTop: 8 }}>
                他{nextActions.length - NEXT_ACTIONS_LIMIT}件（Issue一覧・Organization Contextから確認できます）
              </p>
            )}
          </>
        )}
      </div>

      <div className={styles.fleetRow}>
        {AGENT_OPTIONS.map((name) => {
          const latest = latestRunForAgent(name, runs);
          const stale = latest ? staleRunIds.has(latest.id) : false;
          const meta = stale ? STALE_META : STATUS_META[latest?.status ?? "idle"];
          return (
            <div key={name} className={`${styles.fleetBadge} ${meta.cls}`}>
              <strong>
                {meta.icon} {name}
              </strong>
              <span className={styles.fleetName}>{meta.label}</span>
            </div>
          );
        })}
      </div>

      <div className={`${styles.panel} ${styles.vitalsPanel}`}>
        <div className={styles.vitalsHead}>
          <div>
            <h2>Team Vitals（チーム健全性）</h2>
            <p className={styles.subtitle}>直近のJournalから算出。判断材料が足りない場合は「評価不能」として表示します。</p>
          </div>
          <div className={styles.vitalsLegend}>
            <span>🟢 安定</span>
            <span>🟡/🔴 要注意・危険</span>
            <span>⚪️ 評価不能（情報不足）</span>
          </div>
        </div>

        <div className={styles.vitalsGrid}>
          {vitals.teams.map((v) => (
            <div key={v.teamId} className={`${styles.vitalCard} ${styles[`vital-${v.status}`]}`}>
              <div className={styles.vitalLabel}>{v.teamName}</div>
              <div className={styles.vitalValue}>
                {v.status === "good" ? "🟢" : v.status === "warn" ? "🟡" : v.status === "bad" ? "🔴" : "⚪️"} {v.label}
              </div>
              <button className={styles.detailToggle} onClick={() => setOpenVitalId(openVitalId === v.teamId ? null : v.teamId)}>
                根拠を見る
              </button>
              {openVitalId === v.teamId && <div className={styles.vitalDetail}>{v.reason}</div>}
            </div>
          ))}

          <div className={`${styles.vitalCard} ${styles[`vital-${vitals.oneOnOneCoverage.status}`]}`}>
            <div className={styles.vitalLabel}>1on1 Coverage (30日)</div>
            <div className={styles.vitalValue}>
              {vitals.oneOnOneCoverage.covered} / {vitals.oneOnOneCoverage.total}
            </div>
            <button className={styles.detailToggle} onClick={() => setOpenVitalId(openVitalId === "coverage" ? null : "coverage")}>
              根拠を見る
            </button>
            {openVitalId === "coverage" && <div className={styles.vitalDetail}>{vitals.oneOnOneCoverage.reason}</div>}
          </div>

          {vitals.teams.length === 0 && (
            <p className={styles.subtitle}>
              チームが登録されていません。
              <button className={styles.detailToggle} onClick={() => router.push("/org")}>
                Organization Contextから追加
              </button>
            </p>
          )}
        </div>
      </div>

      <div className={styles.dashColumns}>
        <div className={styles.panel}>
          <h2>Quick Journal (Hybrid Data Ingestion)</h2>
          <form onSubmit={handleJournalSubmit}>
            <div className={styles.journalInputRow}>
              <input
                id="quick-journal-input"
                type="text"
                value={journalText}
                onChange={(e) => setJournalText(e.target.value)}
                placeholder="例: 今日のAさんとの1on1で、リファクタリングが進まないことへの不満を聞いた…"
              />
              <button className={styles.primaryBtn} style={{ width: "auto" }} type="submit" disabled={journalSubmitting || !journalText.trim()}>
                {journalSubmitting ? "タグ付け中…" : "Submit"}
              </button>
            </div>
          </form>
          <p className={styles.subtitle} style={{ margin: "6px 0 12px" }}>
            ※入力後、完全ローカルの軽量モデル（Qwen2.5-0.5B, 外部送信なし）が自動でタグ・人物・緊急度・感情を抽出します。
          </p>
          {journalError && <p className={styles.errorText}>{journalError}</p>}

          {journalEntries.length === 0 && !journalSubmitting && <p className={styles.subtitle}>まだジャーナルはありません。</p>}
          {journalPagination.pageItems.map((entry) => (
            <div key={entry.id} className={styles.journalEntry}>
              <div>{entry.rawText}</div>
              <div className={styles.tagRow}>
                {entry.people.map((p) => (
                  <span key={p} className={`${styles.tag} ${styles.tagPerson}`}>
                    @{p}
                  </span>
                ))}
                {entry.tags.map((t) => (
                  <span key={t} className={`${styles.tag} ${styles.tagTopic}`}>
                    #{t}
                  </span>
                ))}
                {entry.sentiment !== "neutral" && (
                  <span className={`${styles.tag} ${entry.sentiment === "positive" ? styles.tagPos : styles.tagNeg}`}>
                    #{entry.sentiment === "positive" ? "ポジティブ" : "ネガティブ"}
                  </span>
                )}
                <span className={`${styles.urgencyLabel} ${styles[`urgency${entry.urgency}`]}`}>{URGENCY_LABEL[entry.urgency]}</span>
              </div>
            </div>
          ))}
          <PaginationControls
            page={journalPagination.page}
            totalPages={journalPagination.totalPages}
            total={journalPagination.total}
            rangeStart={journalPagination.rangeStart}
            rangeEnd={journalPagination.rangeEnd}
            onChange={journalPagination.setPage}
          />

          <h3 style={{ fontSize: 13, marginTop: 18, marginBottom: 4 }}>長期プロファイル（TTLなし）</h3>
          <p className={styles.subtitle} style={{ marginBottom: 8 }}>
            「Aさんはリーダー志向がある」のような、一時的な感情と混同すべきでない長期的な解釈をここに記録します。Quick
            Journalとは別に保存され、期限切れになりません。
          </p>
          <form onSubmit={handleProfileSubmit}>
            <div className={styles.journalInputRow}>
              <input
                type="text"
                value={profilePerson}
                onChange={(e) => setProfilePerson(e.target.value)}
                placeholder="対象（例: Aさん）"
                style={{ maxWidth: 140 }}
              />
              <input
                type="text"
                value={profileText}
                onChange={(e) => setProfileText(e.target.value)}
                placeholder="例: Aさんはリーダー志向がある"
              />
              <button
                className={styles.primaryBtn}
                style={{ width: "auto" }}
                type="submit"
                disabled={profileSubmitting || !profilePerson.trim() || !profileText.trim()}
              >
                {profileSubmitting ? "記録中…" : "記録"}
              </button>
            </div>
          </form>
          {profileError && <p className={styles.errorText}>{profileError}</p>}
          {profileSaved && <p className={styles.subtitle}>✅ 長期プロファイルとして記録しました。</p>}

          <button
            type="button"
            className={styles.btnOutline}
            style={{ marginTop: 8 }}
            onClick={handleDraftProfile}
            disabled={draftStarting || !profilePerson.trim() || draftRun?.status === "active"}
          >
            {draftStarting || draftRun?.status === "active" ? "AIが下書きを作成中…" : "🤖 AIに下書きを提案してもらう"}
          </button>
          <p className={styles.subtitle} style={{ marginTop: 4 }}>
            対象欄の人物名をもとに、これまでのJournalファクトからPeople Agentが下書きを作成し、上のテキスト欄に反映します（あくまで下書き。保存するかはEMが判断し「記録」を押してください）。
          </p>
          {draftError && <p className={styles.errorText}>{draftError}</p>}
        </div>

        <div className={styles.panel}>
          <h2>Inbox（タスクを起票 / 稼働中のエージェント）</h2>
          <form onSubmit={handleStart}>
            <div className={styles.field}>
              <label>エージェント</label>
              <select value={agentName} onChange={(e) => setAgentName(e.target.value)}>
                {AGENT_OPTIONS.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
            <div className={styles.field}>
              <label>タスク内容</label>
              <textarea
                rows={3}
                value={task}
                onChange={(e) => setTask(e.target.value)}
                placeholder="例: Aさんのリファクタリングが停滞している。Bチームの割り込みタスクが原因らしい。対応方針を検討して。"
              />
            </div>
            <button className={styles.primaryBtn} type="submit" disabled={starting || !task.trim()}>
              {starting ? "起動中…" : "エージェントを起動"}
            </button>
          </form>
          {error && <p className={styles.errorText}>{error}</p>}

          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-muted)", marginTop: 12 }}>
            状態で絞り込み:
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as AgentStatus | "")}>
              <option value="">すべて</option>
              <option value="active">🔵 Active</option>
              <option value="yield">🟡 Yield</option>
              <option value="idle">⚪️ Idle</option>
              <option value="error">🔴 Error</option>
            </select>
          </label>

          <div className={styles.runList} style={{ marginTop: 8 }}>
            {filteredRuns.length === 0 && <p className={styles.subtitle}>条件に一致するエージェントはありません。</p>}
            {inboxPagination.pageItems.map((run) => (
              <button key={run.id} className={styles.runItem} onClick={() => goToRunIssue(run)}>
                <div>
                  <strong>{run.agentName}</strong> <StatusBadge status={run.status} stale={staleRunIds.has(run.id)} />
                  {run.consultedBy && (
                    <span className={styles.subtitle} style={{ marginLeft: 6 }}>
                      🔀 {runs.find((r) => r.id === run.consultedBy)?.agentName ?? "Lead Agent"}からの相談
                    </span>
                  )}
                </div>
                <div className={styles.runItemTask}>{run.task}</div>
              </button>
            ))}
          </div>
          <PaginationControls
            page={inboxPagination.page}
            totalPages={inboxPagination.totalPages}
            total={inboxPagination.total}
            rangeStart={inboxPagination.rangeStart}
            rangeEnd={inboxPagination.rangeEnd}
            onChange={inboxPagination.setPage}
          />
        </div>
      </div>
    </div>
  );
}
