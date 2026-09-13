"use client";

import { useState } from "react";
import styles from "@/app/page.module.css";
import type { AgentRun } from "@/components/RunDetail";
import { JournalEntryCard } from "@/components/JournalEntryCard";
import type { useJournalEditing } from "@/lib/hooks";
import { isJournalEntryResolved, type JournalEntry } from "@/lib/types";
import type { DayPhase } from "@/lib/dashboard-day-phase";

const JOURNAL_DASHBOARD_LIMIT = 5;

// 改修依頼「メモ等の保存前にローカルAIが走る処理を非同期化し、対象のアイテム部分に
// スピナーだけ表示する」対応。POST /api/journal・/api/journal/bulkはローカルモデルの
// 抽出処理を含み数十秒かかることがあるため、Submitボタンでブロックせず、その場に
// 「処理中」のプレースホルダーを1件だけ出して裏で処理する。journalEntries（ポーリングで
// 上書きされうる）とは別のstateで持ち、失敗時は元の入力内容を保持したまま再試行できる
// ようにする。
type PendingJournalDraft = {
  tempId: string;
  label: string;
  error?: string;
  retry?: () => void;
};

type FetchWithNameConfirm = (
  url: string,
  init: { method?: string; body: Record<string, unknown> },
  actionLabel: string,
) => Promise<{ res: Response; data: unknown }>;

type Props = {
  journalText: string;
  onJournalTextChange: (text: string) => void;
  journalEntries: JournalEntry[];
  setJournalEntries: (entries: JournalEntry[] | ((prev: JournalEntry[]) => JournalEntry[])) => void;
  journalLoaded: boolean;
  journalEditing: ReturnType<typeof useJournalEditing>;
  fetchWithNameConfirm: FetchWithNameConfirm;
  runs: AgentRun[];
  refreshRuns: () => Promise<void>;
  dayPhase: DayPhase;
  onNavigate: (path: string) => void;
};

export function JournalDumpPanel({
  journalText,
  onJournalTextChange,
  journalEntries,
  setJournalEntries,
  journalLoaded,
  journalEditing,
  fetchWithNameConfirm,
  runs,
  refreshRuns,
  dayPhase,
  onNavigate,
}: Props) {
  const [journalError, setJournalError] = useState<string | null>(null);
  // 改修依頼「まとめて記録する仕組み」対応。既定は空（＝今日）。EMが「これは今日の話
  // ではない」と分かっているときだけ明示的に開いて指定する（低頻度の操作を毎回の
  // 入力の手間にしない）。
  const [journalDate, setJournalDate] = useState("");
  const [journalDateOpen, setJournalDateOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkResultMessage, setBulkResultMessage] = useState<string | null>(null);
  // 改修依頼「ローカルAIの処理を非同期化する」対応。Submit/まとめて記録するの実処理は
  // どちらもこのリストに「処理中」の1件を積んでから裏で走らせる（下記submitJournalDraft/
  // submitBulkDraft参照）。
  const [pendingJournalDrafts, setPendingJournalDrafts] = useState<PendingJournalDraft[]>([]);
  // docs/memo.md TODO「ダッシュボードトップでは直近５件程度にとどめつつ、Quick Journalを
  // リスト確認・検索できる画面を追加する」対応。トップでは全件ページネーションはせず、
  // 直近5件だけを見せ、全件の検索・絞り込みは/journalに委ねる。
  // ユーザー指摘「メモするについても解決済みをフィルタできるようにしたい。ただしメモは
  // 解決済みでもデフォルトは表示としたい」対応。/journalのexcludeResolvedと判定基準
  // （isJournalEntryResolved）を揃えるが、却下runとは異なりデフォルトはfalse（＝表示）にする。
  const [excludeResolvedJournal, setExcludeResolvedJournal] = useState(false);

  // docs/memo.md「H: 永続化データモデルの設計」対応。Quick Journal（一時的なfact）とは
  // 別に、長期的な解釈（interpretation、TTLなし）を記録する口。「Aさんはリーダー志向がある」
  // のような、一時的な感情と混同すべきでない長期プロファイルはこちらに書く。
  // docs/dashboard_ui_readability.md U4-1対応。Quick Journalと長期プロファイルが
  // 同一パネル内で「入力が2種類」に見えないよう、長期プロファイルは既定で畳んでおく。
  const [profileOpen, setProfileOpen] = useState(false);
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
  const draftRunBusy = draftRun?.status === "active" || draftRun?.status === "queued";
  if (
    draftRun &&
    draftRunId &&
    draftRunId !== consumedDraftRunId &&
    draftRun.status !== "active" &&
    draftRun.status !== "queued"
  ) {
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

  // 改修依頼「メモ等の保存前にローカルAIが走る処理を非同期化する」対応。POST /api/journalは
  // ローカルモデルでの抽出（数十秒かかることがある）を含むため、fetchの完了をSubmitボタンで
  // 待たせない。入力欄は即座にクリアして次の入力を続けられるようにし、処理中は
  // pendingJournalDraftsに積んだプレースホルダー（スピナー表示）だけで進行を示す。
  // 完了後は「AI抽出のまま組織の事実になる」ことを避けるため校正を促したいところだが、
  // Submitからかなり時間が経ってからEMの意図しないタイミングで編集モードを強制的に
  // 開くと混乱を招くため、自動では開かない（🤖未確認バッジ・Journal未確認キューに委ねる）。
  function submitJournalDraft(text: string, occurredAtDate: string | undefined) {
    const tempId = crypto.randomUUID();
    const draft: PendingJournalDraft = { tempId, label: text };
    setPendingJournalDrafts((prev) => [draft, ...prev]);

    (async () => {
      try {
        const { res, data } = await fetchWithNameConfirm(
          "/api/journal",
          { method: "POST", body: { text, occurredAtDate } },
          "保存する",
        );
        if (!res.ok) throw new Error((data as { error?: string } | null)?.error ?? "タグ付けに失敗しました");
        setJournalEntries((prev) => [(data as { entry: JournalEntry }).entry, ...prev]);
        setPendingJournalDrafts((prev) => prev.filter((d) => d.tempId !== tempId));
      } catch (err) {
        if ((err as Error).message === "人名候補の確認をキャンセルしました") {
          setPendingJournalDrafts((prev) => prev.filter((d) => d.tempId !== tempId));
          return;
        }
        setPendingJournalDrafts((prev) =>
          prev.map((d) =>
            d.tempId === tempId
              ? { ...d, error: (err as Error).message, retry: () => submitJournalDraft(text, occurredAtDate) }
              : d,
          ),
        );
      }
    })();
  }

  function handleJournalSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = journalText.trim();
    if (!text) return;
    submitJournalDraft(text, journalDate || undefined);
    onJournalTextChange("");
    setJournalDate("");
    setJournalDateOpen(false);
    setJournalError(null);
  }

  // 改修依頼「まとめて記録する仕組み」対応。EMが忙しくて後からまとめて書く場合に、
  // 1件ずつSubmitさせる負担を無くす。まとめ投入した時刻を全件の発生日にはしない
  // （危険）——サーバー側で行ごとに解決した「出来事があった日」をそのまま使う。
  // 結果は他の未確認エントリと同じくJournal一覧にそのまま並び、個別に校正できる。
  // 改修依頼「ローカルAIの処理を非同期化する」対応。行数分ローカルモデルを繰り返し
  // 呼ぶため単発Submitより時間がかかりやすく、同じくブロックしない非同期処理にする。
  function submitBulkDraft(text: string) {
    const tempId = crypto.randomUUID();
    const lineCount = text.split("\n").map((l) => l.trim()).filter(Boolean).length;
    const draft: PendingJournalDraft = { tempId, label: `まとめて記録中…（${lineCount}行）` };
    setPendingJournalDrafts((prev) => [draft, ...prev]);

    (async () => {
      try {
        const { res, data } = await fetchWithNameConfirm("/api/journal/bulk", { method: "POST", body: { text } }, "保存する");
        if (!res.ok) throw new Error((data as { error?: string } | null)?.error ?? "まとめ記録に失敗しました");
        const newEntries = (data as { entries: JournalEntry[]; skippedLines: number }).entries;
        setJournalEntries((prev) => [...newEntries, ...prev]);
        setPendingJournalDrafts((prev) => prev.filter((d) => d.tempId !== tempId));
        setBulkResultMessage(
          `${newEntries.length}件を記録しました（いずれも未確認）。内容と発生日を確認してください。${
            (data as { skippedLines: number }).skippedLines > 0
              ? ` ※${(data as { skippedLines: number }).skippedLines}行は上限を超えたため処理していません。`
              : ""
          }`,
        );
      } catch (err) {
        if ((err as Error).message === "人名候補の確認をキャンセルしました") {
          setPendingJournalDrafts((prev) => prev.filter((d) => d.tempId !== tempId));
          return;
        }
        setPendingJournalDrafts((prev) =>
          prev.map((d) => (d.tempId === tempId ? { ...d, error: (err as Error).message, retry: () => submitBulkDraft(text) } : d)),
        );
      }
    })();
  }

  function handleBulkSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = bulkText.trim();
    if (!text) return;
    setBulkError(null);
    setBulkResultMessage(null);
    submitBulkDraft(text);
    setBulkText("");
  }

  const visibleJournalEntries = excludeResolvedJournal
    ? journalEntries.filter((e) => !isJournalEntryResolved(e))
    : journalEntries;
  const recentJournalEntries = visibleJournalEntries.slice(0, JOURNAL_DASHBOARD_LIMIT);

  return (
    <div className={styles.panel} id="evening-journal-dump">
      <div className={styles.detailHeader} style={{ alignItems: "center" }}>
        <h2 style={{ margin: 0 }}>
          {dayPhase === "evening" ? "今日あったことを書き連ねる" : "メモする"}{" "}
          <span
            className={`${styles.subtitle} ${styles.axisTooltip}`}
            style={{ fontWeight: 400 }}
            data-tooltip={
              "入力後、完全ローカルの軽量モデル（設定のプリセット、外部送信なし）がタグ・人物・緊急度・感情を自動抽出します。\n分割・Issue昇格は翌朝提案に寄せられます。"
            }
            tabIndex={0}
          >
            ⓘ
          </span>
        </h2>
        <button className={styles.btnOutline} onClick={() => onNavigate("/journal")}>
          すべて見る →
        </button>
      </div>
      {dayPhase === "evening" && (
        <p className={styles.subtitle} style={{ marginTop: 0 }}>
          分割を考えず書いてください。記録と構造化は分離します。
        </p>
      )}
      <form onSubmit={handleJournalSubmit}>
        <div className={styles.journalInputRow}>
          <textarea
            id="quick-journal-input"
            value={journalText}
            onChange={(e) => onJournalTextChange(e.target.value)}
            rows={dayPhase === "evening" ? 6 : 3}
            placeholder={
              dayPhase === "evening"
                ? "今日あったことを、思いつくまま書き連ねてください…"
                : "例: 今日のAさんとの1on1で、リファクタリングが進まないことへの不満を聞いた…"
            }
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing && e.keyCode !== 229) {
                e.preventDefault();
                (e.currentTarget.form as HTMLFormElement | null)?.requestSubmit();
              }
            }}
          />
          <button className={styles.primaryBtn} style={{ width: "auto" }} type="submit" disabled={!journalText.trim()}>
            {dayPhase === "evening" ? "保存" : "Submit"}
          </button>
        </div>
        {/* 改修依頼「通常投入でも日付レベルの訂正を検討」対応。既定は今日のまま・
            非表示。今日の話でないと分かっているときだけ開いて日付を選べる。 */}
        {journalDateOpen ? (
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.75rem", color: "var(--text-muted)" }}>
              発生日
              <input type="date" value={journalDate} onChange={(e) => setJournalDate(e.target.value)} style={{ maxWidth: 160 }} />
            </label>
            <button
              type="button"
              className={`${styles.detailToggle} ${styles.detailToggleButton}`}
              onClick={() => {
                setJournalDate("");
                setJournalDateOpen(false);
              }}
            >
              今日に戻す
            </button>
          </div>
        ) : (
          <button
            type="button"
            className={`${styles.detailToggle} ${styles.detailToggleButton}`}
            style={{ marginTop: 6 }}
            onClick={() => setJournalDateOpen(true)}
          >
            📅 今日の話じゃない（発生日を変える）
          </button>
        )}
      </form>
      {journalError && (
        <p className={styles.errorText} role="alert">
          {journalError}
        </p>
      )}

      <div style={{ marginTop: 10, borderTop: "1px solid var(--border)", paddingTop: 10 }}>
        <button className={`${styles.detailToggle} ${styles.detailToggleButton}`} onClick={() => setBulkOpen(!bulkOpen)}>
          📥 まとめて記録する（後からまとめて書きたいとき） {bulkOpen ? "▲" : "▼"}
        </button>
        {bulkOpen && (
          <form onSubmit={handleBulkSubmit} style={{ marginTop: 8 }}>
            <p className={styles.subtitle} style={{ marginBottom: 6 }}>
              1行＝1つの出来事です。日付が変わるときだけ、その行だけに日付を書いてください（例:
              3/5・月曜・昨日）。省略した行は直前の日付のままになります。時刻は不要です。
            </p>
            <textarea
              rows={5}
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
              style={{
                width: "100%",
                border: "1px solid var(--border)",
                borderRadius: 6,
                padding: "8px 10px",
                fontSize: "0.8125rem",
                fontFamily: "inherit",
                resize: "vertical",
              }}
              placeholder={"3/5\nAさんと1on1。異動の相談を受けた\nBチームとの調整が難航\n月曜\nCさんが有休、引き継ぎ確認"}
            />
            <button className={styles.primaryBtn} style={{ width: "auto", marginTop: 8 }} type="submit" disabled={!bulkText.trim()}>
              まとめて記録する
            </button>
            {bulkError && (
              <p className={styles.errorText} role="alert">
                {bulkError}
              </p>
            )}
            {bulkResultMessage && (
              <p className={styles.subtitle} style={{ marginTop: 6 }} role="status">
                ✅ {bulkResultMessage}
              </p>
            )}
          </form>
        )}
      </div>

      {journalEntries.length > 0 && (
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.75rem", color: "var(--text-muted)", marginTop: 10 }}>
          <input
            type="checkbox"
            checked={excludeResolvedJournal}
            onChange={(e) => setExcludeResolvedJournal(e.target.checked)}
          />
          ✅ 対応済み/Issue化済みを除外
        </label>
      )}
      {journalEntries.length === 0 && pendingJournalDrafts.length === 0 && (
        <p className={styles.subtitle}>{journalLoaded ? "まだジャーナルはありません。" : "読み込み中…"}</p>
      )}
      {journalLoaded && journalEntries.length > 0 && visibleJournalEntries.length === 0 && pendingJournalDrafts.length === 0 && (
        <p className={styles.subtitle}>条件に一致するJournalはありません。</p>
      )}
      {pendingJournalDrafts.map((draft) => (
        <div key={draft.tempId} className={styles.journalEntry}>
          <div>{draft.label}</div>
          {draft.error ? (
            <div className={styles.tagRow} style={{ marginTop: 4 }}>
              <span className={styles.errorText} role="alert">
                ⚠️ {draft.error}
              </span>
              <button className={styles.btnOutline} onClick={draft.retry}>
                再試行
              </button>
              <button
                className={styles.btnOutline}
                onClick={() => setPendingJournalDrafts((prev) => prev.filter((d) => d.tempId !== draft.tempId))}
              >
                取り消す
              </button>
            </div>
          ) : (
            <p className={styles.subtitle} style={{ marginTop: 4 }} role="status">
              <span className={styles.spinner} aria-hidden="true" />
              ローカルAIでタグ付け中…
            </p>
          )}
        </div>
      ))}
      {recentJournalEntries.map((entry) => (
        <JournalEntryCard
          key={entry.id}
          entry={entry}
          editing={journalEditing.editingEntryId === entry.id}
          editRawText={journalEditing.editRawText}
          editTags={journalEditing.editTags}
          editPeople={journalEditing.editPeople}
          editTeams={journalEditing.editTeams}
          editUrgency={journalEditing.editUrgency}
          editDate={journalEditing.editDate}
          editSubmitting={journalEditing.editSubmitting}
          editError={journalEditing.editError}
          resolutionNoteDraft={journalEditing.resolutionNoteDraft}
          pending={journalEditing.isEntryPending(entry.id)}
          pendingError={journalEditing.pendingEntryErrors[entry.id]}
          onDismissPendingError={() => journalEditing.dismissPendingError(entry.id)}
          onChangeEditRawText={journalEditing.setEditRawText}
          onChangeEditTags={journalEditing.setEditTags}
          onChangeEditPeople={journalEditing.setEditPeople}
          onChangeEditTeams={journalEditing.setEditTeams}
          onChangeEditUrgency={journalEditing.setEditUrgency}
          onChangeEditDate={journalEditing.setEditDate}
          onChangeResolutionNoteDraft={journalEditing.setResolutionNoteDraft}
          onConfirmEdit={() => journalEditing.confirmEdit(entry.id)}
          onConfirmAsIs={() => journalEditing.confirmAsIs(entry)}
          onStartAnalysis={() => journalEditing.startAnalysis(entry)}
          onCancelEdit={journalEditing.cancelEditing}
          onStartEdit={() => journalEditing.startEditing(entry)}
          onResolveWithNote={() => journalEditing.resolveWithNote(entry.id)}
          onResolveWithNewIssue={() => journalEditing.resolveWithNewIssue(entry)}
          onClearResolution={() => journalEditing.clearResolution(entry.id)}
        />
      ))}
      {visibleJournalEntries.length > JOURNAL_DASHBOARD_LIMIT && (
        <p className={styles.subtitle} style={{ marginTop: -4, marginBottom: 12 }}>
          他{visibleJournalEntries.length - JOURNAL_DASHBOARD_LIMIT}件は
          <button className={styles.detailToggle} onClick={() => onNavigate("/journal")}>
            Journal一覧
          </button>
          から確認できます。
        </p>
      )}

      <div style={{ marginTop: 18, borderTop: "1px solid var(--border)", paddingTop: 10 }}>
        <button className={`${styles.detailToggle} ${styles.detailToggleButton}`} onClick={() => setProfileOpen(!profileOpen)}>
          長期プロファイルを記録する {profileOpen ? "▲" : "▼"}
        </button>
        {profileOpen && (
          <>
            <p className={styles.subtitle} style={{ margin: "6px 0 8px" }}>
              「Aさんはリーダー志向がある」のような長期的な解釈を、Quick Journalとは別に期限切れなく記録します。
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
                <textarea
                  value={profileText}
                  onChange={(e) => setProfileText(e.target.value)}
                  rows={2}
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
            {profileError && (
              <p className={styles.errorText} role="alert">
                {profileError}
              </p>
            )}
            {profileSaved && (
              <p className={styles.subtitle} role="status">
                ✅ 長期プロファイルとして記録しました。
              </p>
            )}

            <button
              type="button"
              className={styles.btnOutline}
              style={{ marginTop: 8 }}
              onClick={handleDraftProfile}
              disabled={draftStarting || !profilePerson.trim() || draftRunBusy}
            >
              {draftStarting || draftRunBusy ? "AIが下書きを作成中…" : "🤖 AIに下書きを提案してもらう"}
            </button>
            <p
              className={styles.subtitle}
              style={{ marginTop: 4 }}
              title="対象欄の人物名をもとにPeople Agentが下書きを作成します。保存するかはEMが判断してください。"
            >
              ⓘ あくまで下書きです。「記録」を押すまで保存されません。
            </p>
            {draftError && (
              <p className={styles.errorText} role="alert">
                {draftError}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
