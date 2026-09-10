"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "@/app/page.module.css";
import { MarkdownView } from "@/components/MarkdownView";
import { isJournalEntryResolved, journalResolutionLabel, URGENCY_LABEL, type JournalEntry } from "@/lib/types";

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
  editing,
  editRawText,
  editTags,
  editPeople,
  editUrgency,
  editDate,
  editSubmitting,
  editError,
  resolutionNoteDraft,
  pending,
  pendingError,
  onChangeEditRawText,
  onChangeEditTags,
  onChangeEditPeople,
  onChangeEditUrgency,
  onChangeEditDate,
  onChangeResolutionNoteDraft,
  onConfirmEdit,
  onCancelEdit,
  onStartEdit,
  onResolveWithNote,
  onResolveWithNewIssue,
  onClearResolution,
  onDismissPendingError,
}: {
  entry: JournalEntry;
  editing: boolean;
  editRawText: string;
  editTags: string;
  editPeople: string;
  editUrgency: JournalEntry["urgency"];
  editDate: string;
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
  onChangeEditUrgency: (value: JournalEntry["urgency"]) => void;
  onChangeEditDate: (value: string) => void;
  onChangeResolutionNoteDraft: (value: string) => void;
  onConfirmEdit: () => void;
  onCancelEdit: () => void;
  onStartEdit: () => void;
  onResolveWithNote: () => void;
  onResolveWithNewIssue: () => Promise<string | undefined>;
  onClearResolution: () => void;
  onDismissPendingError: () => void;
}) {
  const router = useRouter();
  const isResolved = isJournalEntryResolved(entry);
  // docs/em_human_story_and_ux.md 改修依頼「本文編集は他の編集項目より頻度が低いので、
  // 編集を押したときだけ編集モードに入るようにする」対応。tags/people/urgency/日付は
  // 編集モードに入ると常に触れるが、本文はIssueのタイトル編集と同じくボタンで
  // 明示的に開始する（うっかり本文を書き換えてしまう事故も減らせる）。
  const [rawTextRevealed, setRawTextRevealed] = useState(false);

  async function handleCreateIssue() {
    const issueId = await onResolveWithNewIssue();
    if (issueId) {
      setRawTextRevealed(false);
      router.push(`/issues/${issueId}`);
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
        <div style={{ display: "flex", gap: 6 }}>
          <button className={styles.primaryBtn} style={{ width: "auto" }} disabled={editSubmitting} onClick={handleConfirm}>
            {editSubmitting ? "確定中…" : "この内容で確定"}
          </button>
          <button className={styles.btnOutline} disabled={editSubmitting} onClick={handleCancel}>
            キャンセル
          </button>
        </div>

        {/* docs/em_human_story_and_ux.md 改修依頼対応。Urgencyは起きた出来事自体の
            深刻さの記録として書き換えず、「今どこで管理されているか」を別途記録できる
            ようにする。 */}
        <div className={styles.field} style={{ marginTop: 14, paddingTop: 10, borderTop: "1px solid var(--border)" }}>
          <span className={styles.fieldCaption}>解決 / 追跡</span>
          {isResolved ? (
            <div>
              <p className={styles.subtitle} style={{ margin: "0 0 6px" }}>
                {entry.resolvedIssueId
                  ? `✅ Issue「${entry.resolvedIssueTitle ?? "(不明)"}」で追跡中です。`
                  : `✅ メモを残して解決済みにしています: ${entry.resolutionNote}`}
              </p>
              <div style={{ display: "flex", gap: 6 }}>
                {entry.resolvedIssueId && (
                  <button className={styles.btnOutline} onClick={() => router.push(`/issues/${entry.resolvedIssueId}`)}>
                    Issueを開く
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
              <button className={styles.btnOutline} disabled={editSubmitting} onClick={handleCreateIssue} style={{ marginBottom: 8 }}>
                Issueを起票してこの件を追跡する
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

  return (
    <div className={`${styles.journalEntry} ${isResolved ? styles.journalEntryResolved : ""}`}>
      {/* 改修依頼「対応済みラベルを本文前につけることでより『対応済み』がわかりやすい
          ようにする」対応。tagRow内の✅チップ（Issueへのリンク・メモの詳細）とは別に、
          本文を読み始める前に一目で分かるよう先頭に軽量なラベルを添える。 */}
      {isResolved && (
        <span className={`${styles.tag} ${styles.tagPos}`} style={{ marginRight: 6 }}>
          {journalResolutionLabel(entry)}
        </span>
      )}
      {/* docs/em_ui_ux_issue.md 7節「閲覧ビューと編集ビューの分離」対応。本文はMarkdownで
          描画し、クリックでも編集モードへ入れるようにする（アクセシブルな入口は下の
          「編集」ボタン）。 */}
      <div className={styles.editableTextView} onClick={onStartEdit}>
        <MarkdownView text={entry.rawText} />
      </div>
      <div className={styles.tagRow}>
        <span className={styles.subtitle} title="出来事の発生日">
          🗓 {formatEntryDate(entry.createdAt)}
        </span>
        {entry.people.map((p) => (
          <button
            key={p}
            className={`${styles.tag} ${styles.tagPerson} ${styles.tagBtn}`}
            onClick={() => router.push(`/chat?prefill=${encodeURIComponent(`${p}について最近の懸念を整理して`)}`)}
          >
            @{p}
          </button>
        ))}
        {entry.tags.map((t) => (
          <button
            key={t}
            className={`${styles.tag} ${styles.tagTopic} ${styles.tagBtn}`}
            onClick={() => router.push(`/issues?tag=${encodeURIComponent(t)}`)}
          >
            #{t}
          </button>
        ))}
        {entry.sentiment !== "neutral" && (
          <span className={`${styles.tag} ${entry.sentiment === "positive" ? styles.tagPos : styles.tagNeg}`}>
            #{entry.sentiment === "positive" ? "ポジティブ" : "ネガティブ"}
          </span>
        )}
        <span className={`${styles.urgencyLabel} ${styles[`urgency${entry.urgency}`]}`}>{URGENCY_LABEL[entry.urgency]}</span>
        {/* docs/em_human_story_and_ux.md 改修依頼対応。urgencyは記録のまま変えないため、
            「今どこで管理されているか」をurgencyバッジとは別に見せる。 */}
        {entry.resolvedIssueId ? (
          <button
            className={`${styles.tag} ${styles.tagPos} ${styles.tagBtn}`}
            title={`Issue「${entry.resolvedIssueTitle ?? "(不明)"}」で追跡中です`}
            onClick={() => router.push(`/issues/${entry.resolvedIssueId}`)}
          >
            ✅ Issueで追跡中
          </button>
        ) : (
          entry.resolutionNote && (
            <span className={`${styles.tag} ${styles.tagPos}`} title={entry.resolutionNote}>
              ✅ 対応済み
            </span>
          )
        )}
        {!entry.confirmed && (
          <span
            className={styles.subtitle}
            title="AIの自動抽出のままです。内容・発生日が正しければ「編集」→「この内容で確定」で確認してください。"
          >
            🤖 未確認
          </span>
        )}
        <button className={`${styles.detailToggle} ${styles.detailToggleButton}`} onClick={onStartEdit}>
          編集
        </button>
      </div>
    </div>
  );
}
