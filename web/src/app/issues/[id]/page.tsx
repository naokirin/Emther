"use client";

import { use, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import styles from "@/app/page.module.css";
import { CopilotChat, ExecutionState, StatusBadge, type AgentRun } from "@/components/RunDetail";
import { Modal } from "@/components/Modal";
import { useEntityHistory, useIssue, useIssueImpact, useIssues, useObjectives, useRuns, useSettingsRules, useTeams } from "@/lib/hooks";
import { INTERVENTION_TYPES, charterFilledCount, isRunStale } from "@/lib/types";

export default function IssueDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { issue, refreshIssue } = useIssue(id);
  const { history } = useEntityHistory("issue", id);
  const { issues, refreshIssues } = useIssues();
  const { runs, refreshRuns } = useRuns();
  const { objectives } = useObjectives();
  const { teams } = useTeams();
  // docs/memo.md「L. 介入の閉ループ」対応。アーカイブ済み・チーム紐付き済みのIssueでのみ
  // 意味を持つため、その場合だけポーリングする。
  const { impact } = useIssueImpact(id, !!issue?.teamId);
  const { rules } = useSettingsRules();
  const staleRunIds = new Set(
    runs.filter((r) => isRunStale(r.status, r.updatedAt, rules.agentStaleAfterSeconds)).map((r) => r.id),
  );

  // 親子関係は1階層のみ。子（parentIdあり）は自分の子を持てないので
  // 「サブIssueを追加」は表示せず、「上位Issueを作る」も既に親を持つなら表示しない。
  const parentIssue = issue?.parentId ? issues.find((i) => i.id === issue.parentId) ?? null : null;
  const childIssues = issue ? issues.filter((i) => i.parentId === issue.id) : [];

  const [hierarchyDialog, setHierarchyDialog] = useState<"child" | "parent" | null>(null);
  const [hTitle, setHTitle] = useState("");
  const [hWhy, setHWhy] = useState("");
  const [hWhat, setHWhat] = useState("");
  const [hHow, setHHow] = useState("");
  const [hSubmitting, setHSubmitting] = useState(false);
  const [hError, setHError] = useState<string | null>(null);

  function closeHierarchyDialog() {
    setHierarchyDialog(null);
    setHTitle("");
    setHWhy("");
    setHWhat("");
    setHHow("");
    setHError(null);
  }

  async function handleCreateChild(e: React.FormEvent) {
    e.preventDefault();
    if (!issue || !hTitle.trim()) return;
    setHSubmitting(true);
    setHError(null);
    try {
      const res = await fetch("/api/issues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: hTitle, why: hWhy, what: hWhat, how: hHow, parentId: issue.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "サブIssueの作成に失敗しました");
      closeHierarchyDialog();
      router.push(`/issues/${data.issue.id}`);
    } catch (err) {
      setHError((err as Error).message);
    } finally {
      setHSubmitting(false);
    }
  }

  async function handleCreateParent(e: React.FormEvent) {
    e.preventDefault();
    if (!issue || !hTitle.trim()) return;
    setHSubmitting(true);
    setHError(null);
    try {
      const res = await fetch(`/api/issues/${issue.id}/parent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: hTitle, why: hWhy, what: hWhat, how: hHow }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "上位Issueの作成に失敗しました");
      closeHierarchyDialog();
      await refreshIssues();
      router.push(`/issues/${data.issue.id}`);
    } catch (err) {
      setHError((err as Error).message);
    } finally {
      setHSubmitting(false);
    }
  }

  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [deciding, setDeciding] = useState(false);
  const [decideError, setDecideError] = useState<string | null>(null);
  const [actionItemText, setActionItemText] = useState("");
  // ユーザー依頼「EMがIssueに対して考えたこと・取ったアクション・結果を反映する」対応。
  const [logText, setLogText] = useState("");
  const [logSubmitting, setLogSubmitting] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);

  // docs/em_human_story_and_ux.md 改修依頼「Issueのタイトルを変更できるようにする」対応。
  // titleEditingはEMのクリックで開始する（issueの非同期取得を待つ必要はなく、編集ボタン
  // 自体issueが揃ってから初めて描画されるため、レンダー中の同期は不要）。
  const [titleEditing, setTitleEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [titleSaving, setTitleSaving] = useState(false);
  const [titleError, setTitleError] = useState<string | null>(null);

  const [charterSaving, setCharterSaving] = useState(false);
  const [charterError, setCharterError] = useState<string | null>(null);
  const whyRef = useRef<HTMLTextAreaElement | null>(null);
  const whatRef = useRef<HTMLTextAreaElement | null>(null);
  const howRef = useRef<HTMLTextAreaElement | null>(null);
  const tagsRef = useRef<HTMLInputElement | null>(null);
  // docs/memo.md「G. Issueに『介入の型』を足す」対応。tagsRefは非制御入力なので、
  // チップのハイライト表示だけをこのstateで追従させる（保存時はtagsRef.current.valueを読む）。
  // issueは非同期取得のため初回レンダー時点ではundefined——データが揃ったタイミングを
  // レンダー中に検知して同期する（useEffectは使わない。以降のポーリング更新では
  // 上書きしないので、編集中の選択状態を壊さない）。
  const [tagsSnapshot, setTagsSnapshot] = useState<string[]>([]);
  const [syncedIssueId, setSyncedIssueId] = useState<string | null>(null);
  // docs/memo.md「H. 戦略→Issue→結果の一本線」対応。keyResultIdの選択も同じ理由
  // （issueの非同期取得）で、同じタイミングにまとめて同期する。
  const [keyResultIdDraft, setKeyResultIdDraft] = useState<string>("");
  const [keyResultSaving, setKeyResultSaving] = useState(false);
  // docs/memo.md「I. チーム単位の憲法」対応。teamIdの選択も同じ理由でまとめて同期する。
  const [teamIdDraft, setTeamIdDraft] = useState<string>("");
  const [teamLinkSaving, setTeamLinkSaving] = useState(false);
  if (issue && issue.id !== syncedIssueId) {
    setSyncedIssueId(issue.id);
    setTagsSnapshot(issue.tags);
    setKeyResultIdDraft(issue.keyResultId ?? "");
    setTeamIdDraft(issue.teamId ?? "");
  }

  async function handleChangeKeyResult(keyResultId: string) {
    if (!issue) return;
    setKeyResultIdDraft(keyResultId);
    setKeyResultSaving(true);
    try {
      const res = await fetch(`/api/issues/${issue.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyResultId: keyResultId || null }),
      });
      if (res.ok) await refreshIssue();
    } finally {
      setKeyResultSaving(false);
    }
  }

  async function handleChangeTeam(teamId: string) {
    if (!issue) return;
    setTeamIdDraft(teamId);
    setTeamLinkSaving(true);
    try {
      const res = await fetch(`/api/issues/${issue.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId: teamId || null }),
      });
      if (res.ok) await refreshIssue();
    } finally {
      setTeamLinkSaving(false);
    }
  }

  function toggleInterventionType(label: string) {
    if (!tagsRef.current) return;
    const current = tagsRef.current.value.split(",").map((t) => t.trim()).filter(Boolean);
    const next = current.includes(label) ? current.filter((t) => t !== label) : [...current, label];
    tagsRef.current.value = next.join(", ");
    setTagsSnapshot(next);
  }

  function startEditingTitle() {
    if (!issue) return;
    setTitleDraft(issue.title);
    setTitleError(null);
    setTitleEditing(true);
  }

  async function handleSaveTitle() {
    if (!issue) return;
    const trimmed = titleDraft.trim();
    if (!trimmed) {
      setTitleError("タイトルは必須です");
      return;
    }
    setTitleSaving(true);
    setTitleError(null);
    try {
      const res = await fetch(`/api/issues/${issue.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: trimmed }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "保存に失敗しました");
      }
      await refreshIssue();
      await refreshIssues();
      setTitleEditing(false);
    } catch (err) {
      setTitleError((err as Error).message);
    } finally {
      setTitleSaving(false);
    }
  }

  async function handleSaveCharter() {
    if (!issue) return;
    setCharterSaving(true);
    setCharterError(null);
    try {
      const res = await fetch(`/api/issues/${issue.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          why: whyRef.current?.value ?? "",
          what: whatRef.current?.value ?? "",
          how: howRef.current?.value ?? "",
          tags: (tagsRef.current?.value ?? "").split(",").map((t) => t.trim()).filter(Boolean),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "保存に失敗しました");
      }
      await refreshIssue();
    } catch (err) {
      setCharterError((err as Error).message);
    } finally {
      setCharterSaving(false);
    }
  }

  const [archiving, setArchiving] = useState(false);

  async function handleToggleArchived() {
    if (!issue) return;
    setArchiving(true);
    try {
      const res = await fetch(`/api/issues/${issue.id}/archive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: !issue.archived }),
      });
      if (res.ok) await refreshIssue();
    } finally {
      setArchiving(false);
    }
  }

  const linkedRun: AgentRun | null = issue ? runs.find((r) => r.id === issue.agentRunId) ?? null : null;

  async function sendDecision(text: string) {
    if (!linkedRun || !text.trim()) return;
    setDeciding(true);
    setDecideError(null);
    try {
      const res = await fetch(`/api/agents/${linkedRun.id}/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "送信に失敗しました");
      setMessage("");
      setSelectedOptionId(null);
      await refreshRuns();
    } catch (err) {
      setDecideError((err as Error).message);
    } finally {
      setDeciding(false);
    }
  }

  function handleConfirmOption() {
    if (!linkedRun || !selectedOptionId) return;
    const opt = linkedRun.yieldRequest?.options.find((o) => o.id === selectedOptionId);
    if (!opt) return;
    sendDecision(`Option ${opt.id}（${opt.label}）を採用します。この方針で進めてください。`);
  }

  function handleFocusChat() {
    document.getElementById("issue-chat-input")?.focus();
  }

  async function handleAddActionItem() {
    if (!issue || !actionItemText.trim()) return;
    try {
      const res = await fetch(`/api/issues/${issue.id}/action-items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: actionItemText }),
      });
      if (res.ok) {
        setActionItemText("");
        await refreshIssue();
      }
    } catch {
      // 失敗時は次回のポーリングで状態が揃う
    }
  }

  // ユーザー依頼「EMがIssueに対して考えたこと・取ったアクション・結果を反映する」対応。
  // Action Itemsと同じ「1件ずつ即追記」の作りだが、done等の状態は持たない自由記述ログ。
  async function handleAddLogEntry() {
    if (!issue || !logText.trim()) return;
    setLogSubmitting(true);
    setLogError(null);
    try {
      const res = await fetch(`/api/issues/${issue.id}/log`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: logText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "記録に失敗しました");
      setLogText("");
      await refreshIssue();
    } catch (err) {
      setLogError((err as Error).message);
    } finally {
      setLogSubmitting(false);
    }
  }

  const [actionItemsSubmitting, setActionItemsSubmitting] = useState(false);

  // docs/first_implession 3.8対応。AIが提案したAction Itemsを、実際にIssue.actionItemsへ
  // 追加するかどうかはEMが選ぶ（採用/却下いずれの場合も提案自体はrunから消し、
  // 同じ提案が表示され続けないようにする）。
  async function handleAdoptSuggestedActionItems(items: string[]) {
    if (!issue || !linkedRun) return;
    setActionItemsSubmitting(true);
    try {
      for (const text of items) {
        await fetch(`/api/issues/${issue.id}/action-items`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
      }
      await fetch(`/api/agents/${linkedRun.id}/action-items/dismiss`, { method: "POST" });
      await Promise.all([refreshIssue(), refreshRuns()]);
    } finally {
      setActionItemsSubmitting(false);
    }
  }

  async function handleDismissSuggestedActionItems() {
    if (!linkedRun) return;
    setActionItemsSubmitting(true);
    try {
      await fetch(`/api/agents/${linkedRun.id}/action-items/dismiss`, { method: "POST" });
      await refreshRuns();
    } finally {
      setActionItemsSubmitting(false);
    }
  }

  const [subIssuesSubmitting, setSubIssuesSubmitting] = useState(false);

  // docs/memo.md「K. ズームイン／ズームアウトの協働計画」対応。AIが提案した子Issue分解案を、
  // 実際にサブIssueとして作成するかどうかはEMが選ぶ（既存のサブIssue作成APIをそのまま
  // 複数回叩くだけで、新しい起票経路は増やさない）。
  async function handleAdoptSuggestedSubIssues(items: string[]) {
    if (!issue || !linkedRun) return;
    setSubIssuesSubmitting(true);
    try {
      for (const title of items) {
        await fetch("/api/issues", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, parentId: issue.id }),
        });
      }
      await fetch(`/api/agents/${linkedRun.id}/sub-issues/dismiss`, { method: "POST" });
      await Promise.all([refreshIssue(), refreshIssues(), refreshRuns()]);
    } finally {
      setSubIssuesSubmitting(false);
    }
  }

  async function handleDismissSuggestedSubIssues() {
    if (!linkedRun) return;
    setSubIssuesSubmitting(true);
    try {
      await fetch(`/api/agents/${linkedRun.id}/sub-issues/dismiss`, { method: "POST" });
      await refreshRuns();
    } finally {
      setSubIssuesSubmitting(false);
    }
  }

  const [charterSubmitting, setCharterSubmitting] = useState(false);

  // ユーザー依頼「Journal等からIssueを生成する際、AIエージェントチームに内容を埋めさせる」
  // 対応。AIが提案したWhy/What/Howの埋め合わせ案を、実際にIssue.charterへ反映するか
  // どうかはEMが選ぶ（既存のPATCH /api/issues/[id]をそのまま叩くだけで、新しい更新経路は
  // 増やさない。提案に含まれない項目はキー自体を送らないため上書きされない）。
  async function handleAdoptSuggestedCharter(charter: { why?: string; what?: string; how?: string }) {
    if (!issue || !linkedRun) return;
    setCharterSubmitting(true);
    try {
      await fetch(`/api/issues/${issue.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(charter),
      });
      await fetch(`/api/agents/${linkedRun.id}/charter/dismiss`, { method: "POST" });
      await Promise.all([refreshIssue(), refreshRuns()]);
    } finally {
      setCharterSubmitting(false);
    }
  }

  async function handleDismissSuggestedCharter() {
    if (!linkedRun) return;
    setCharterSubmitting(true);
    try {
      await fetch(`/api/agents/${linkedRun.id}/charter/dismiss`, { method: "POST" });
      await refreshRuns();
    } finally {
      setCharterSubmitting(false);
    }
  }

  async function handleToggleActionItem(itemId: string) {
    if (!issue) return;
    try {
      const res = await fetch(`/api/issues/${issue.id}/action-items/${itemId}`, { method: "PATCH" });
      if (res.ok) await refreshIssue();
    } catch {
      // 失敗時は次回のポーリングで状態が揃う
    }
  }

  if (!issue) {
    return (
      <div className={styles.screen}>
        <Link href="/issues" className={styles.backLink}>
          ← Issue一覧に戻る
        </Link>
        <p className={styles.subtitle}>読み込み中、またはIssueが見つかりません。</p>
      </div>
    );
  }

  return (
    <div className={styles.screen}>
      <Link href="/issues" className={styles.backLink}>
        ← Issue一覧に戻る
      </Link>

      {parentIssue && (
        <Link href={`/issues/${parentIssue.id}`} className={styles.backLink} style={{ display: "block" }}>
          ⬆ 上位Issue: {parentIssue.title}
        </Link>
      )}

      <div className={styles.issueTitleRow}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {titleEditing ? (
            <div className={styles.field} style={{ maxWidth: 480 }}>
              <input
                type="text"
                aria-label="タイトル"
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                disabled={titleSaving}
                autoFocus
              />
              <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                <button className={styles.primaryBtn} style={{ width: "auto" }} disabled={titleSaving} onClick={handleSaveTitle}>
                  {titleSaving ? "保存中…" : "保存"}
                </button>
                <button className={styles.btnOutline} disabled={titleSaving} onClick={() => setTitleEditing(false)}>
                  キャンセル
                </button>
              </div>
              {titleError && (
                <p className={styles.errorText} role="alert">
                  {titleError}
                </p>
              )}
            </div>
          ) : (
            <>
              <h2 style={{ display: "inline" }}>{issue.title}</h2>{" "}
              <button
                className={`${styles.detailToggle} ${styles.detailToggleButton}`}
                onClick={startEditingTitle}
              >
                編集
              </button>
              <br />
              {linkedRun && <StatusBadge status={linkedRun.status} stale={staleRunIds.has(linkedRun.id)} />}
              {issue.archived && (
                <span className={styles.subtitle} style={{ marginLeft: 6 }}>
                  🗄 アーカイブ済み
                </span>
              )}
            </>
          )}
        </div>
        <button className={styles.btnOutline} onClick={handleToggleArchived} disabled={archiving}>
          {issue.archived ? "アーカイブを解除" : "アーカイブする"}
        </button>
      </div>

      {decideError && <p className={styles.errorText} role="alert">{decideError}</p>}

      {/* ユーザー依頼「EMがIssueに対して考えたこと・取ったアクション・結果を反映する」
          対応。Action Items（やる/やった）とは別に、進行中いつでも書き足せる自由記述の
          経過ログ。種別（考えたこと／アクション／結果）は分けず、EMが自由に書く。 */}
      <div className={styles.panel}>
        <h2>経過ログ</h2>
        <p className={styles.subtitle} style={{ marginBottom: 10 }}>
          考えたこと・取ったアクション・分かった結果を、思いついた時にひとことずつ書き足してください。まとめて振り返る必要はありません。
        </p>
        <div className={styles.journalInputRow}>
          <input
            type="text"
            value={logText}
            onChange={(e) => setLogText(e.target.value)}
            placeholder="例: Bチームと調整し、割り込み受付時間を14〜15時に限定することで合意"
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAddLogEntry();
            }}
          />
          <button
            className={styles.primaryBtn}
            style={{ width: "auto" }}
            type="button"
            disabled={logSubmitting || !logText.trim()}
            onClick={handleAddLogEntry}
          >
            {logSubmitting ? "記録中…" : "記録"}
          </button>
        </div>
        {logError && (
          <p className={styles.errorText} role="alert">
            {logError}
          </p>
        )}
        {issue.logEntries.length === 0 ? (
          <p className={styles.subtitle} style={{ marginTop: 10 }}>
            まだ記録がありません。
          </p>
        ) : (
          <ul style={{ listStyle: "none", marginTop: 10 }}>
            {[...issue.logEntries].reverse().map((entry) => (
              <li key={entry.id} className={styles.field} style={{ marginBottom: 8 }}>
                <div style={{ fontSize: "0.8125rem" }}>{entry.text}</div>
                <div className={styles.subtitle}>{new Date(entry.createdAt).toLocaleString("ja-JP")}</div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {issue.teamId && (
        <div className={styles.panel}>
          <h2>介入の効果（{teams.find((t) => t.id === issue.teamId)?.name ?? "関連チーム"}）{impact?.inProgress && "・進行中"}</h2>
          <p className={styles.subtitle}>
            {impact?.inProgress
              ? // docs/em_human_story_and_ux.md P2-15対応。完了（アーカイブ）を待たずに、
                // 「介入を始めてから、そもそも観測できているか」を確認できるようにする。
                "「感覚」ではなく観測に基づいて判断できるよう、このIssueの介入開始前とその後（現在まで）でチームのJournal傾向がどう変化したかを機械的に比較します（手動でのスコア入力はありません）。アーカイブ前の暫定値です。"
              : "「感覚」ではなく観測に基づいてピボット判断できるよう、このIssueのアーカイブ前後でチームのJournal傾向がどう変化したかを機械的に比較します（手動でのスコア入力はありません）。"}
          </p>
          {!impact ? (
            <p className={styles.subtitle}>読み込み中…</p>
          ) : (
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              <div className={styles.vitalCard} style={{ minWidth: 220 }}>
                <div className={styles.vitalLabel}>{impact.inProgress ? "介入開始前" : "アーカイブ前"} 直近{impact.windowDays}日間</div>
                <div className={styles.vitalValue}>
                  Journal {impact.before.total}件（🙂{impact.before.positive} 🙁{impact.before.negative}）
                </div>
              </div>
              <div className={styles.vitalCard} style={{ minWidth: 220 }}>
                <div className={styles.vitalLabel}>{impact.inProgress ? "介入開始〜現在" : `アーカイブ後 直近${impact.windowDays}日間`}</div>
                <div className={styles.vitalValue}>
                  Journal {impact.after.total}件（🙂{impact.after.positive} 🙁{impact.after.negative}）
                </div>
              </div>
            </div>
          )}
          {impact && impact.after.total === 0 && (
            <p className={styles.subtitle} style={{ marginTop: 8 }}>
              {impact.inProgress
                ? "介入開始後、このチームに関するJournalの記録がまだありません。効果測定のためにも、関連するJournalを記録してください。"
                : "アーカイブ後まだ観測期間が経過していない、またはJournalの記録がありません。しばらく経ってから確認してください。"}
            </p>
          )}
        </div>
      )}

      {!issue.parentId && (
        <div className={`${styles.panel} ${styles.charterSection}`}>
          <div className={styles.detailHeader}>
            <h2 style={{ margin: 0 }}>サブIssue（分解した子Issue）</h2>
            <div style={{ display: "flex", gap: 8 }}>
              <button className={styles.btnOutline} onClick={() => setHierarchyDialog("child")}>
                ＋ サブIssueを追加
              </button>
              {childIssues.length === 0 && (
                <button className={styles.btnOutline} onClick={() => setHierarchyDialog("parent")}>
                  ⬆ 上位Issueを作る
                </button>
              )}
            </div>
          </div>
          <p className={styles.subtitle} style={{ marginBottom: 10 }}>
            複雑な階層を避けるため、親子関係は1階層まで（サブIssueがさらに自分の子を持つことはできません）。
          </p>
          {childIssues.length === 0 ? (
            <p className={styles.subtitle}>まだサブIssueはありません。</p>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>タイトル</th>
                    <th>Why/What/How</th>
                    <th>Action Items</th>
                  </tr>
                </thead>
                <tbody>
                  {childIssues.map((child) => {
                    const childRun = runs.find((r) => r.id === child.agentRunId);
                    const childCharter = charterFilledCount(child.charter);
                    return (
                      <tr key={child.id} style={child.archived ? { opacity: 0.6 } : undefined}>
                        <td>
                          <button className={styles.tableRowLink} onClick={() => router.push(`/issues/${child.id}`)}>
                            {child.title}
                          </button>
                          <div style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                            {childRun && <StatusBadge status={childRun.status} stale={staleRunIds.has(childRun.id)} />}
                            {child.archived && <span className={styles.tableMuted}>🗄 アーカイブ済み</span>}
                          </div>
                        </td>
                        <td>
                          <span className={childCharter === 3 ? styles.charterBadgeReady : styles.charterBadgeWarn}>
                            {childCharter === 3 ? "✅" : "❓"} {childCharter}/3
                          </span>
                        </td>
                        <td>
                          {child.actionItems.filter((a) => a.done).length}/{child.actionItems.length}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div className={`${styles.panel} ${styles.charterSection}`} key={issue.id}>
        <h2>Why / What / How</h2>
        <p className={styles.subtitle} style={{ marginBottom: 10 }}>
          計画・実行の前に明らかにしておくべき3要素。分かっている範囲で記入し、空欄（点線＝未整理）が残っている場合は着手前に明確にしてください。
        </p>

        {charterFilledCount(issue.charter) < 3 && (
          <div className={styles.charterWarnBanner}>
            ⚠️ Why/What/Howが{charterFilledCount(issue.charter)}/3しか整理されていません。点線の欄が「まだ分かっていないこと」です。計画や実行を進める前に明確にすることを推奨します。
          </div>
        )}

        <div className={styles.charterField}>
          <label>Why（生む価値・誰のため・なぜ今か）
          <textarea
            ref={whyRef}
            rows={2}
            defaultValue={issue.charter.why}
            className={issue.charter.why ? "" : styles.charterEmpty}
            placeholder="未整理（クリックして記入）"
          /></label>
        </div>
        <div className={styles.charterField}>
          <label>What（何を・どこまで・どのくらい・完了の定義）
          <textarea
            ref={whatRef}
            rows={2}
            defaultValue={issue.charter.what}
            className={issue.charter.what ? "" : styles.charterEmpty}
            placeholder="未整理（クリックして記入）"
          /></label>
        </div>
        <div className={styles.charterField}>
          <label>How（どのように実現するか・前提や制約）
          <textarea
            ref={howRef}
            rows={2}
            defaultValue={issue.charter.how}
            className={issue.charter.how ? "" : styles.charterEmpty}
            placeholder="未整理（クリックして記入）"
          /></label>
        </div>
        <div className={styles.field}>
          <label>関連チーム（任意。そのチームのMission/制約を前提として注入する）
          <select value={teamIdDraft} onChange={(e) => handleChangeTeam(e.target.value)} disabled={teamLinkSaving}>
            <option value="">なし</option>
            {teams
              .filter((t) => !t.archived)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
          </select></label>
        </div>
        <div className={styles.field}>
          <label>紐付けるKey Result（任意。「今期何を解いているか」の一本線を作る）
          <select value={keyResultIdDraft} onChange={(e) => handleChangeKeyResult(e.target.value)} disabled={keyResultSaving}>
            <option value="">なし</option>
            {objectives.map((o) =>
              o.keyResults.map((kr) => (
                <option key={kr.id} value={kr.id}>
                  {o.title} ＞ {kr.title}
                </option>
              )),
            )}
          </select></label>
        </div>
        <div className={styles.field}>
          <span className={styles.fieldCaption}>介入の型（実装タスクではなく仕組み・人・組織への介入の切り口）</span>
          <div role="group" aria-label="介入の型（複数選択可）" style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {INTERVENTION_TYPES.map((t) => (
              <button
                key={t.label}
                type="button"
                className={`${styles.typeChip} ${tagsSnapshot.includes(t.label) ? styles.typeChipSelected : ""}`}
                onClick={() => toggleInterventionType(t.label)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <div className={styles.field}>
          <label>タグ（カンマ区切り）
          <input
            type="text"
            ref={tagsRef}
            defaultValue={issue.tags.join(", ")}
            onChange={(e) => setTagsSnapshot(e.target.value.split(",").map((t) => t.trim()).filter(Boolean))}
            placeholder="例: バグ, リファクタリング, オンボーディング"
          /></label>
        </div>
        {issue.tags.length > 0 && (
          <div className={styles.tagRow} style={{ marginBottom: 10 }}>
            {issue.tags.map((tag) => (
              <span key={tag} className={`${styles.tag} ${styles.tagTopic}`}>
                #{tag}
              </span>
            ))}
          </div>
        )}
        {charterError && <p className={styles.errorText} role="alert">{charterError}</p>}
        <button className={styles.primaryBtn} style={{ width: "auto" }} disabled={charterSaving} onClick={handleSaveCharter}>
          {charterSaving ? "保存中…" : "Why/What/How・タグを保存"}
        </button>

        {history.length > 0 && (
          <details style={{ marginTop: 14 }}>
            <summary style={{ cursor: "pointer", fontSize: "0.75rem", color: "var(--text-muted)" }}>
              変更履歴（{history.length}件）
            </summary>
            <ul style={{ listStyle: "none", marginTop: 8 }}>
              {history.map((h) => (
                <li key={h.id} style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: 4 }}>
                  {new Date(h.occurredAt).toLocaleString("ja-JP")} — {h.text}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>

      <div className={styles.issueColumns}>
        <div className={styles.panel}>
          <h2>Execution State</h2>
          {linkedRun ? (
            <ExecutionState
              run={linkedRun}
              selectedOptionId={selectedOptionId}
              onSelectOption={setSelectedOptionId}
              onConfirmOption={handleConfirmOption}
              onFocusChat={handleFocusChat}
              deciding={deciding}
              stale={staleRunIds.has(linkedRun.id)}
              onRetry={() => sendDecision("直前の処理がエラーで中断しました。同じ内容を踏まえて再度実行してください。")}
              onAdoptActionItems={handleAdoptSuggestedActionItems}
              onDismissActionItems={handleDismissSuggestedActionItems}
              actionItemsSubmitting={actionItemsSubmitting}
              onAdoptSubIssues={handleAdoptSuggestedSubIssues}
              onDismissSubIssues={handleDismissSuggestedSubIssues}
              subIssuesSubmitting={subIssuesSubmitting}
              onAdoptCharter={handleAdoptSuggestedCharter}
              onDismissCharter={handleDismissSuggestedCharter}
              charterSubmitting={charterSubmitting}
            />
          ) : (
            <p className={styles.subtitle}>
              Agent Runが紐づいていません。Dashboardでタスクを起票するか、Issue一覧から紐づけてください。横断相談から続けたい場合は
              <Link href="/chat"> 「何でも相談」</Link> へ。
            </p>
          )}

          <h2 style={{ marginTop: 16 }}>Action Items (Draft)</h2>
          {issue.actionItems.length === 0 && <p className={styles.subtitle}>まだありません。</p>}
          <ul style={{ listStyle: "none", marginBottom: 10 }}>
            {issue.actionItems.map((item) => (
              <li key={item.id} style={{ fontSize: "0.8125rem", marginBottom: 6 }}>
                <label style={{ display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
                  <input type="checkbox" checked={item.done} onChange={() => handleToggleActionItem(item.id)} />
                  <span style={{ textDecoration: item.done ? "line-through" : "none", color: item.done ? "var(--text-muted)" : "inherit" }}>
                    {item.text}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <div className={styles.chatRow}>
            <input
              type="text"
              placeholder="Action Itemを追加…"
              value={actionItemText}
              onChange={(e) => setActionItemText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAddActionItem();
              }}
            />
            <button className={styles.primaryBtn} style={{ width: "auto" }} disabled={!actionItemText.trim()} onClick={handleAddActionItem}>
              追加
            </button>
          </div>
        </div>

        <div className={styles.panel}>
          <h2>Copilot Workspace (Interactive)</h2>
          {linkedRun ? (
            <>
              <p className={styles.subtitle} style={{ marginBottom: 8 }}>この Issue の壁打ちはここで行います。</p>
              <CopilotChat run={linkedRun} message={message} setMessage={setMessage} deciding={deciding} onDecide={sendDecision} inputId="issue-chat-input" />
            </>
          ) : (
            <p className={styles.subtitle}>Agent Runが無いため会話はありません。</p>
          )}
        </div>
      </div>

      {hierarchyDialog && (
        <Modal
          title={hierarchyDialog === "child" ? "サブIssueを追加" : "上位Issueを作る"}
          onClose={closeHierarchyDialog}
        >
          <form onSubmit={hierarchyDialog === "child" ? handleCreateChild : handleCreateParent}>
            <div className={styles.field}>
              <label>タイトル
              <input type="text" autoFocus value={hTitle} onChange={(e) => setHTitle(e.target.value)} placeholder="例: 割り込みタスクの受け入れ基準を定める" /></label>
            </div>
            <div className={styles.field}>
              <label>Why（生む価値・誰のため・なぜ今か）
              <textarea rows={2} value={hWhy} onChange={(e) => setHWhy(e.target.value)} /></label>
            </div>
            <div className={styles.field}>
              <label>What（何を・どこまで・どのくらい・完了の定義）
              <textarea rows={2} value={hWhat} onChange={(e) => setHWhat(e.target.value)} /></label>
            </div>
            <div className={styles.field}>
              <label>How（どのように実現するか・前提や制約）
              <textarea rows={2} value={hHow} onChange={(e) => setHHow(e.target.value)} /></label>
            </div>
            {hError && <p className={styles.errorText} role="alert">{hError}</p>}
            <button className={styles.primaryBtn} type="submit" disabled={hSubmitting || !hTitle.trim()}>
              {hierarchyDialog === "child" ? "サブIssueを作成" : "上位Issueを作成"}
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}
