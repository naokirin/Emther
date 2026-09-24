import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import styles from "../styles/page.module.css";
import { MarkdownView } from "./MarkdownView";
import { StrategyTrail } from "./StrategyTrail";
import { useSuggestionPeek } from "./useSuggestionPeek";
import { buildJournalStrategyTrail } from "@emther/core/strategy-trail";
import {
  isJournalEntryResolved,
  journalResolutionLabel,
  type JournalEntry,
  type Suggestion,
} from "@emther/core/types";

const URGENCY_SHORT: Record<JournalEntry["urgency"], string> = {
  low: "Low",
  mid: "Mid",
  high: "High",
};

// docs/em_human_story_and_ux.md 改修依頼「まとめて記録する仕組み」対応。まとめ入力・日付
// 訂正により、entry.createdAt（＝出来事の発生日）が「今日」以外になり得るため、常に
// 発生日を短く表示する（今日/昨日はそう書き、それ以外はM/D）。
function formatEntryDate(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(today) - startOf(d)) / (24 * 60 * 60 * 1000));
  if (diffDays === 0) return "今日";
  if (diffDays === 1) return "昨日";
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// docs/memo.md TODO「Quick JournalをEMが後からリスト確認・検索しにくいUIになっている」対応。
// Dashboard（直近5件）とJournal一覧（全件検索）の両方で同じ表示・その場編集UIを使うための
// 共有コンポーネント。編集状態そのものは@/lib/hooksのuseJournalEditingが持ち、
// このコンポーネントは表示に専念する。改修依頼「表形式を戻してほしい」対応。Journalは
// 自由記述の本文＋タグが主役で、カラムに分けてもわかりやすくならず、個別のエントリを
// 1件ずつ読む場面の方が多いため、カードの並びに戻す（表形式にはしない）。
export function JournalEntryCard({
  entry,
  // docs/memo.md「戦略→提案→Journalの縦の接続が見えづらい」対応。resolvedSuggestionId経由で
  // 提案まで辿れるときだけパンくずを出す。呼び出し側で未指定なら何も出さない
  // （Dashboard等、既に手一杯な画面での強制表示は避ける）。
  suggestions = [],
  editing,
  editRawText,
  editTags,
  editPeople,
  editTeams,
  editUrgency,
  editSentiment,
  editDate,
  editSensitive,
  editSubmitting,
  editError,
  resolutionNoteDraft,
  pending,
  pendingError,
  onChangeEditRawText,
  onChangeEditTags,
  onChangeEditPeople,
  onChangeEditTeams,
  onChangeEditUrgency,
  onChangeEditSentiment,
  onChangeEditDate,
  onChangeEditSensitive,
  onChangeResolutionNoteDraft,
  onConfirmEdit,
  onConfirmAsIs,
  onStartAnalysis,
  onCancelEdit,
  onStartEdit,
  onResolveWithNote,
  onResolveWithNewSuggestion,
  onClearResolution,
  onAcknowledgeSentiment,
  onClearSentimentAck,
  onArchive,
  onUnarchive,
  onMarkSensitive,
  onUnmarkSensitive,
  onDismissPendingError,
  onTagClick,
}: {
  entry: JournalEntry;
  suggestions?: Pick<Suggestion, "id" | "title">[];
  editing: boolean;
  editRawText: string;
  editTags: string;
  editPeople: string;
  editTeams: string;
  editUrgency: JournalEntry["urgency"];
  // ユーザー指摘「Journalのネガティブ・ポジティブを人が変更できない」対応。
  editSentiment: JournalEntry["sentiment"];
  editDate: string;
  editSensitive: boolean;
  editSubmitting: boolean;
  editError: string | null;
  resolutionNoteDraft: string;
  // 改修依頼「メモ等の保存前にローカルAIが走る処理を非同期化し、対象のアイテム部分に
  // スピナーだけ表示する」対応。pending中はこのエントリの編集フォームを閉じたまま
  // バックグラウンドで更新中であることだけを示す（他のエントリの編集は妨げない）。
  pending: boolean;
  pendingError?: { message: string; retry: () => void };
  onChangeEditRawText: (value: string) => void;
  onChangeEditTags: (value: string) => void;
  onChangeEditPeople: (value: string) => void;
  onChangeEditTeams: (value: string) => void;
  onChangeEditUrgency: (value: JournalEntry["urgency"]) => void;
  onChangeEditSentiment: (value: JournalEntry["sentiment"]) => void;
  onChangeEditDate: (value: string) => void;
  onChangeEditSensitive: (value: boolean) => void;
  onChangeResolutionNoteDraft: (value: string) => void;
  onConfirmEdit: () => void;
  // docs/usage_issues U16。未確認エントリを編集せずに確定する。
  onConfirmAsIs?: () => void;
  // docs/usage_issues U16。確定済みで相談未作成のとき、手動で分析を起動する。成功時は runId。
  onStartAnalysis?: () => Promise<string | undefined>;
  onCancelEdit: () => void;
  onStartEdit: () => void;
  onResolveWithNote: () => void;
  onResolveWithNewSuggestion: () => Promise<string | undefined>;
  onClearResolution: () => void;
  // ユーザー指摘「確認したが対応不要だった、を示せずネガポジ等の強調を減らせない」対応。
  onAcknowledgeSentiment: () => void;
  onClearSentimentAck: () => void;
  // docs/memo.md「相談、Journal、提案を削除（アーカイブ）したい」対応。呼び出し側が省略
  // した場合はボタン自体を出さない（Dashboard等、まだ配線していない画面向け）。
  onArchive?: () => void;
  onUnarchive?: () => void;
  // センシティブ設定。呼び出し側が省略した場合はメニュー項目自体を出さない。
  onMarkSensitive?: () => void;
  onUnmarkSensitive?: () => void;
  onDismissPendingError: () => void;
  /** タグクリックで Journal 一覧を絞り込む（未指定ならタグは表示のみ） */
  onTagClick?: (tag: string) => void;
}) {
  const navigate = useNavigate();
  const suggestionPeek = useSuggestionPeek();
  const isResolved = isJournalEntryResolved(entry);
  // docs/em_human_story_and_ux.md 改修依頼「本文編集は他の編集項目より頻度が低いので、
  // 編集を押したときだけ編集モードに入るようにする」対応。tags/people/urgency/日付は
  // 編集モードに入ると常に触れるが、本文は提案のタイトル編集と同じくボタンで
  // 明示的に開始する（うっかり本文を書き換えてしまう事故も減らせる）。
  const [rawTextRevealed, setRawTextRevealed] = useState(false);
  const [analysisStarting, setAnalysisStarting] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onMouseDown(e: MouseEvent) {
      if (menuRef.current?.contains(e.target as Node)) return;
      setMenuOpen(false);
    }
    function onKeyDownCapture(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      setMenuOpen(false);
    }
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDownCapture, true);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDownCapture, true);
    };
  }, [menuOpen]);

  async function handleCreateSuggestion() {
    const suggestionId = await onResolveWithNewSuggestion();
    if (suggestionId) {
      setRawTextRevealed(false);
      suggestionPeek.open(suggestionId);
    }
  }

  function handleResolveWithNote() {
    setRawTextRevealed(false);
    onResolveWithNote();
  }

  function handleCancel() {
    setRawTextRevealed(false);
    onCancelEdit();
  }

  function handleConfirm() {
    setRawTextRevealed(false);
    onConfirmEdit();
  }

  async function handleStartAnalysis() {
    if (!onStartAnalysis || analysisStarting) return;
    setAnalysisStarting(true);
    try {
      const runId = await onStartAnalysis();
      if (runId) navigate(`/chat?runId=${runId}`);
    } finally {
      setAnalysisStarting(false);
    }
  }

  // 改修依頼「メモ等の保存前にローカルAIが走る処理を非同期化し、対象のアイテム部分に
  // スピナーだけ表示する」対応。エラーは編集フォームを閉じたあとに届くことがあるため、
  // editingとは独立してこのエントリ自体に出す（再試行すれば元の内容のまま送り直せる）。
  if (pendingError) {
    return (
      <div className={styles.journalEntry}>
        <MarkdownView text={entry.rawText} />
        <div className={styles.tagRow} style={{ marginTop: 4 }}>
          <span className={styles.errorText} role="alert">
            ⚠️ 更新に失敗しました: {pendingError.message}
          </span>
          <button className={styles.btnOutline} onClick={pendingError.retry}>
            再試行
          </button>
          <button className={styles.btnOutline} onClick={onDismissPendingError}>
            閉じる
          </button>
        </div>
      </div>
    );
  }

  if (pending) {
    return (
      <div className={styles.journalEntry}>
        <MarkdownView text={entry.rawText} />
        <p className={styles.subtitle} style={{ marginTop: 4 }} role="status">
          <span className={styles.spinner} aria-hidden="true" />
          更新中…
        </p>
      </div>
    );
  }

  if (editing) {
    return (
      <div className={styles.journalEntry}>
        {rawTextRevealed ? (
          <div className={styles.field}>
            <label>
              本文
              <textarea
                value={editRawText}
                onChange={(e) => onChangeEditRawText(e.target.value)}
                rows={3}
              />
            </label>
          </div>
        ) : (
          <div>
            {/* docs/em_ui_ux_issue.md 7節対応。テキスト領域自体のクリックでも編集を開始
                できるようにする（アクセシブルな入口は下の「本文を編集」ボタン）。 */}
            <div className={styles.editableTextView} onClick={() => setRawTextRevealed(true)}>
              <MarkdownView text={entry.rawText} />
            </div>
            <button
              className={`${styles.detailToggle} ${styles.detailToggleButton}`}
              onClick={() => setRawTextRevealed(true)}
            >
              本文を編集
            </button>
          </div>
        )}
        <div className={styles.field} style={{ marginTop: 8 }}>
          <label>
            発生日（時刻は不要）
            <input type="date" value={editDate} onChange={(e) => onChangeEditDate(e.target.value)} style={{ maxWidth: 160 }} />
          </label>
        </div>
        <div className={styles.field}>
          <label>
            人物（カンマ区切り）
            <input type="text" value={editPeople} onChange={(e) => onChangeEditPeople(e.target.value)} placeholder="例: Aさん, Bさん" />
          </label>
        </div>
        <div className={styles.field}>
          <label>
            チーム（カンマ区切り。登録済みのチーム名・別名）
            <input
              type="text"
              value={editTeams}
              onChange={(e) => onChangeEditTeams(e.target.value)}
              placeholder="例: コアチーム, Engineering"
            />
          </label>
        </div>
        <div className={styles.field}>
          <label>
            タグ（カンマ区切り）
            <input type="text" value={editTags} onChange={(e) => onChangeEditTags(e.target.value)} placeholder="例: 1on1, 技術的負債" />
          </label>
        </div>
        <div className={styles.field}>
          {/* 改修依頼「デフォルトのセレクトボックスの多用による選択のしにくさ」対応。
              3択の固定選択肢はプルダウンで隠さない。 */}
          <span className={styles.fieldCaption}>Urgency</span>
          <div role="group" aria-label="Urgency" style={{ display: "flex", gap: 6 }}>
            {(["low", "mid", "high"] as const).map((u) => (
              <button
                key={u}
                type="button"
                className={`${styles.typeChip} ${editUrgency === u ? styles.typeChipSelected : ""}`}
                onClick={() => onChangeEditUrgency(u)}
              >
                {u === "low" ? "Low" : u === "mid" ? "Mid" : "High"}
              </button>
            ))}
          </div>
        </div>
        <div className={styles.field}>
          {/* ユーザー指摘「Journalのネガティブ・ポジティブを人が変更できない」対応。
              ローカルモデルの自動判定が実態と違う場合に、EMがその場で直せるようにする。 */}
          <span className={styles.fieldCaption}>ネガティブ・ポジティブ</span>
          <div role="group" aria-label="ネガティブ・ポジティブ" style={{ display: "flex", gap: 6 }}>
            {(["positive", "neutral", "negative"] as const).map((s) => (
              <button
                key={s}
                type="button"
                className={`${styles.typeChip} ${editSentiment === s ? styles.typeChipSelected : ""}`}
                onClick={() => onChangeEditSentiment(s)}
              >
                {s === "positive" ? "ポジティブ" : s === "negative" ? "ネガティブ" : "ニュートラル"}
              </button>
            ))}
          </div>
        </div>
        <label
          className={styles.field}
          style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.8rem", color: "var(--text-muted)" }}
        >
          <input
            type="checkbox"
            checked={editSensitive}
            onChange={(e) => onChangeEditSensitive(e.target.checked)}
            disabled={editSubmitting}
          />
          <span className={styles.axisTooltip} data-tooltip="オンにすると、既定の一覧・Dashboard・人物詳細には表示されません">
            センシティブ（一覧に出さない）
          </span>
        </label>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <button className={styles.primaryBtn} style={{ width: "auto" }} disabled={editSubmitting} onClick={handleConfirm}>
            {editSubmitting ? "確定中…" : "この内容で確定"}
          </button>
          <button className={styles.btnOutline} disabled={editSubmitting} onClick={handleCancel}>
            キャンセル
          </button>
          {entry.confirmed && !entry.sourceConsultRunId && onStartAnalysis && (
            <button
              className={`${styles.btnOutline} ${styles.axisTooltip}`}
              disabled={editSubmitting || analysisStarting}
              onClick={() => void handleStartAnalysis()}
              data-tooltip="設定の自動条件に関係なく、Lead AgentにこのJournalの分析を依頼します。"
            >
              {analysisStarting ? "起動中…" : "分析する"}
            </button>
          )}
        </div>
        {!entry.confirmed ? (
          <p className={styles.subtitle} style={{ margin: "6px 0 0" }}>
            投稿直後は分析しません。確定後、設定の条件に合うと自動分析が起動します。条件外でも後から「分析する」で起動できます。
          </p>
        ) : (
          !entry.sourceConsultRunId &&
          onStartAnalysis && (
            <p className={styles.subtitle} style={{ margin: "6px 0 0" }}>
              自動条件に合わなくても「分析する」でLeadに依頼できます。
            </p>
          )
        )}

        {/* docs/em_human_story_and_ux.md 改修依頼対応。Urgencyは起きた出来事自体の
            深刻さの記録として書き換えず、「今どこで管理されているか」を別途記録できる
            ようにする。 */}
        <div className={styles.field} style={{ marginTop: 14, paddingTop: 10, borderTop: "1px solid var(--border)" }}>
          <span className={styles.fieldCaption}>解決 / 追跡</span>
          {entry.sourceConsultRunId && (
            <div style={{ marginBottom: 10 }}>
              <p className={styles.subtitle} style={{ margin: "0 0 6px" }}>
                💬 このJournalから相談が生まれています。
              </p>
              <button
                className={styles.btnOutline}
                onClick={() => navigate(`/chat?runId=${entry.sourceConsultRunId}`)}
              >
                相談を開く
              </button>
            </div>
          )}
          {isResolved ? (
            <div>
              <p className={styles.subtitle} style={{ margin: "0 0 6px" }}>
                {entry.resolvedSuggestionId
                  ? `✅ 提案「${entry.resolvedSuggestionTitle ?? "(不明)"}」で追跡中です。`
                  : `✅ メモを残して解決済みにしています: ${entry.resolutionNote}`}
              </p>
              <div style={{ display: "flex", gap: 6 }}>
                {entry.resolvedSuggestionId && (
                  <button className={styles.btnOutline} onClick={() => suggestionPeek.open(entry.resolvedSuggestionId!)}>
                    提案を開く
                  </button>
                )}
                <button className={styles.btnOutline} disabled={editSubmitting} onClick={onClearResolution}>
                  解決を取り消す
                </button>
              </div>
            </div>
          ) : (
            <div>
              <p className={styles.subtitle} style={{ margin: "0 0 6px" }}>
                Urgencyは記録のまま変えず、別枠でこの件をどう扱っているかを残せます。
              </p>
              <button className={styles.btnOutline} disabled={editSubmitting} onClick={handleCreateSuggestion} style={{ marginBottom: 8 }}>
                提案を起票してこの件を追跡する
              </button>
              <div style={{ display: "flex", gap: 6 }}>
                <textarea
                  aria-label="解決メモ"
                  value={resolutionNoteDraft}
                  onChange={(e) => onChangeResolutionNoteDraft(e.target.value)}
                  placeholder="例: 本人と話して解消済み"
                  rows={2}
                  style={{ flex: 1 }}
                />
                <button className={styles.btnOutline} disabled={editSubmitting} onClick={handleResolveWithNote}>
                  メモを残して解決にする
                </button>
              </div>
            </div>
          )}
        </div>

        {editError && (
          <p className={styles.errorText} role="alert">
            {editError}
          </p>
        )}
      </div>
    );
  }

  const statusLabel = !entry.confirmed
    ? "未確認"
    : entry.resolvedSuggestionId
      ? "提案で追跡中"
      : entry.resolutionNote
        ? journalResolutionLabel(entry) || "対応済み"
        : entry.confirmed
          ? "確定済"
          : null;

  const statusClass = !entry.confirmed
    ? styles.journalStatusUnconfirmed
    : entry.resolvedSuggestionId || entry.resolutionNote
      ? styles.journalStatusResolved
      : styles.journalStatusConfirmed;

  const primaryAction: {
    label: string;
    onClick: () => void;
    primary: boolean;
    tooltip: string;
    disabled?: boolean;
  } | null = !entry.confirmed && onConfirmAsIs
    ? {
        label: "確定する",
        onClick: onConfirmAsIs,
        primary: true,
        tooltip: "修正なしで内容を確定します。設定の条件に合う場合は自動分析が起動します。",
      }
    : entry.resolvedSuggestionId
      ? {
          label: "提案を開く",
          onClick: () => suggestionPeek.open(entry.resolvedSuggestionId!),
          primary: false,
          tooltip: `提案「${entry.resolvedSuggestionTitle ?? "(不明)"}」で追跡中です`,
        }
      : entry.confirmed && !entry.sourceConsultRunId && onStartAnalysis
        ? {
            label: analysisStarting ? "起動中…" : "分析する",
            onClick: () => void handleStartAnalysis(),
            primary: false,
            tooltip: "設定の自動条件に関係なく、Lead AgentにこのJournalの分析を依頼します。",
            disabled: analysisStarting,
          }
        : null;

  return (
    <div className={`${styles.journalEntry} ${isResolved ? styles.journalEntryResolved : ""}`}>
      {/* docs/design/journal/journal-tab.pen 改善案A「カードのごちゃつき」対応。
          層を分ける: ①状態＋誰・いつ ②本文 ③シグナル ④主アクション1つ。
          編集・アーカイブ・対応不要・相談などは ⋯ メニューへ。 */}
      <div className={styles.journalCardHead}>
        <div className={styles.journalCardHeadLeft}>
          {statusLabel && (
            <span
              className={`${styles.journalStatusBadge} ${statusClass} ${styles.axisTooltip}`}
              data-tooltip={
                !entry.confirmed
                  ? "AIの自動抽出のままです。正しければ「確定する」、直すなら「編集」してください。"
                  : entry.resolvedSuggestionId
                    ? `提案「${entry.resolvedSuggestionTitle ?? "(不明)"}」で追跡中です`
                    : entry.resolutionNote
                      ? entry.resolutionNote
                      : undefined
              }
              tabIndex={0}
            >
              {statusLabel}
            </span>
          )}
          <span className={`${styles.journalCardMeta} ${styles.axisTooltip}`} data-tooltip="出来事の発生日" tabIndex={0}>
            {formatEntryDate(entry.createdAt)}
          </span>
          {entry.people.map((p) => (
            <button
              key={p}
              className={`${styles.journalCardMetaBtn} ${styles.tagBtn}`}
              onClick={() => navigate(`/chat?prefill=${encodeURIComponent(`${p}について最近の懸念を整理して`)}`)}
            >
              @{p}
            </button>
          ))}
          {(entry.teamNames ?? []).map((name, i) => (
            <button
              key={entry.teamIds[i] ?? name}
              className={`${styles.journalCardMetaBtn} ${styles.tagBtn} ${styles.axisTooltip}`}
              data-tooltip="関連チーム"
              onClick={() => navigate("/teams")}
            >
              {name}
            </button>
          ))}
          {entry.archivedAt && (
            <span className={`${styles.journalCardMeta} ${styles.axisTooltip}`} data-tooltip="一覧・AIの判断材料からは除外されています" tabIndex={0}>
              アーカイブ済み
            </span>
          )}
          {entry.sensitiveAt && (
            <span
              className={`${styles.journalCardMeta} ${styles.axisTooltip}`}
              data-tooltip="既定の一覧には表示されません（フィルタで「センシティブも表示する」をオンにすると見えます）"
              tabIndex={0}
            >
              センシティブ
            </span>
          )}
        </div>
        <div className={styles.journalMoreMenu} ref={menuRef}>
          <button
            type="button"
            className={`${styles.journalMoreTrigger} ${menuOpen ? styles.journalFloatingTriggerOpen : ""}`}
            aria-label="その他の操作"
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            onClick={() => setMenuOpen((v) => !v)}
          >
            ⋯
          </button>
          {menuOpen && (
            <div className={`${styles.journalFloatingMenu} ${styles.journalMoreMenuPanel}`} role="menu">
              <button
                type="button"
                role="menuitem"
                className={styles.journalMoreItem}
                onClick={() => {
                  setMenuOpen(false);
                  onStartEdit();
                }}
              >
                編集
              </button>
              {entry.sentiment === "negative" &&
                (entry.noActionNeededAt ? (
                  <button
                    type="button"
                    role="menuitem"
                    className={styles.journalMoreItem}
                    onClick={() => {
                      setMenuOpen(false);
                      onClearSentimentAck();
                    }}
                  >
                    確認を取り消す
                  </button>
                ) : (
                  <button
                    type="button"
                    role="menuitem"
                    className={styles.journalMoreItem}
                    onClick={() => {
                      setMenuOpen(false);
                      onAcknowledgeSentiment();
                    }}
                  >
                    確認済み/対応不要とする
                  </button>
                ))}
              {entry.sourceConsultRunId && (
                <button
                  type="button"
                  role="menuitem"
                  className={styles.journalMoreItem}
                  onClick={() => {
                    setMenuOpen(false);
                    navigate(`/chat?runId=${entry.sourceConsultRunId}`);
                  }}
                >
                  💬 相談を開く
                </button>
              )}
              {entry.sourceDumpId && (
                <button
                  type="button"
                  role="menuitem"
                  className={styles.journalMoreItem}
                  onClick={() => {
                    setMenuOpen(false);
                    navigate(`/journal?dump=${encodeURIComponent(entry.sourceDumpId!)}`);
                  }}
                >
                  📥 取り込み元
                </button>
              )}
              {(entry.archivedAt ? onUnarchive : onArchive) && (
                <>
                  <div className={styles.journalMoreDivider} role="separator" />
                  <button
                    type="button"
                    role="menuitem"
                    className={`${styles.journalMoreItem} ${styles.journalMoreItemDanger}`}
                    onClick={() => {
                      setMenuOpen(false);
                      (entry.archivedAt ? onUnarchive : onArchive)?.();
                    }}
                  >
                    {entry.archivedAt ? "アーカイブを解除" : "アーカイブする"}
                  </button>
                </>
              )}
              {(entry.sensitiveAt ? onUnmarkSensitive : onMarkSensitive) && (
                <button
                  type="button"
                  role="menuitem"
                  className={styles.journalMoreItem}
                  onClick={() => {
                    setMenuOpen(false);
                    (entry.sensitiveAt ? onUnmarkSensitive : onMarkSensitive)?.();
                  }}
                >
                  {entry.sensitiveAt ? "センシティブを解除" : "センシティブにする"}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <div className={styles.editableTextView} onClick={onStartEdit}>
        <MarkdownView text={entry.rawText} />
      </div>
      {entry.resolvedSuggestionId && (
        <StrategyTrail nodes={buildJournalStrategyTrail(entry, suggestions)} currentKind="journal" />
      )}

      <div className={styles.journalCardSignals}>
        <div className={styles.journalCardSignalsLeft}>
          <span className={`${styles.urgencyLabel} ${styles[`urgency${entry.urgency}`]}`}>{URGENCY_SHORT[entry.urgency]}</span>
          {entry.sentiment !== "neutral" &&
            (entry.sentiment === "negative" && entry.noActionNeededAt ? (
              <span
                className={`${styles.journalSentiment} ${styles.tagPerson} ${styles.axisTooltip}`}
                data-tooltip={
                  entry.noActionNeededNote
                    ? `確認済み（対応不要と判断）: ${entry.noActionNeededNote}`
                    : "確認済み（対応不要と判断）"
                }
                tabIndex={0}
              >
                ネガティブ（確認済み）
              </span>
            ) : (
              <span
                className={`${styles.journalSentiment} ${entry.sentiment === "positive" ? styles.tagPos : styles.tagNeg}`}
              >
                {entry.sentiment === "positive" ? "ポジティブ" : "ネガティブ"}
              </span>
            ))}
          {entry.tags.length > 0 && (
            <span className={styles.journalCardTags}>
              {entry.tags.map((t) =>
                onTagClick ? (
                  <button
                    key={t}
                    type="button"
                    className={`${styles.journalCardTagBtn} ${styles.tagBtn}`}
                    onClick={() => onTagClick(t)}
                  >
                    #{t}
                  </button>
                ) : (
                  <span key={t} className={styles.journalCardTagBtn}>
                    #{t}
                  </span>
                ),
              )}
            </span>
          )}
        </div>
        {primaryAction && (
          <button
            type="button"
            className={`${primaryAction.primary ? styles.primaryBtn : styles.btnOutline} ${styles.journalCardAction} ${styles.axisTooltip}`}
            disabled={primaryAction.disabled}
            onClick={primaryAction.onClick}
            data-tooltip={primaryAction.tooltip}
          >
            {primaryAction.label}
          </button>
        )}
      </div>
    </div>
  );
}
