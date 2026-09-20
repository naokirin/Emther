import { useState } from "react";
import { timestampToDateInputValue } from "@emther/core/journal-date-parser";
import { truncateForTitle, type JournalEntry } from "@emther/core/types";
import { useNameCandidateConfirm } from "./useNameCandidateConfirm";

// docs/memo.md「C. Journalセンシング→行動」対応のその場編集ロジックを、Dashboardと
// Journal一覧（TODO「Quick Journalをリスト確認・検索できる画面を追加する」）の両方で
// 共有するための共通フック。同時に編集できるのは呼び出し側の画面ごとに1件のみ。
export function useJournalEditing(
  journalEntries: JournalEntry[],
  setJournalEntries: (entries: JournalEntry[] | ((prev: JournalEntry[]) => JournalEntry[])) => void,
) {
  const { fetchWithNameConfirm, nameCandidateDialog } = useNameCandidateConfirm();
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  // docs/em_human_story_and_ux.md 改修依頼「Journalの本文を編集できるようにする」対応。
  const [editRawText, setEditRawText] = useState("");
  // 改修依頼「メモ等の保存前にローカルAIが走る処理を非同期化する」対応。本文が実際に
  // 触られた場合だけPATCHにrawTextを含める（毎回含めると、触っていなくても
  // maskForStorage（ローカルNER）が走り、tags/urgency等だけの軽い確定まで重くなってしまう）。
  const [rawTextTouched, setRawTextTouched] = useState(false);
  const [editTags, setEditTags] = useState("");
  const [editPeople, setEditPeople] = useState("");
  const [editTeams, setEditTeams] = useState("");
  const [editUrgency, setEditUrgency] = useState<JournalEntry["urgency"]>("mid");
  // ユーザー指摘「Journalのネガティブ・ポジティブを人が変更できない」対応。urgencyと同じ扱い。
  const [editSentiment, setEditSentiment] = useState<JournalEntry["sentiment"]>("neutral");
  // docs/em_human_story_and_ux.md 改修依頼「まとめ入力・通常投入どちらでも日付レベルの
  // 訂正を扱えるように」対応。"YYYY-MM-DD"（<input type="date">の値）で保持する。
  const [editDate, setEditDate] = useState("");
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // docs/em_human_story_and_ux.md 改修依頼「urgency:highのまま解決済みにできない」対応。
  // Issueの起票・メモでの解決も、通常の確定と同じくその時点のtags/people/urgency/日付の
  // 編集内容を一緒に反映する（別のフォームとして分離すると二度手間になるため）。
  const [resolutionNoteDraft, setResolutionNoteDraft] = useState("");

  // 改修依頼「メモ等の保存前にローカルAIが走る処理を非同期化し、対象のアイテム部分に
  // スピナーだけ表示する」対応。resolutionNote／rawTextを伴う更新はmaskForStorage
  // （ローカルNER）を通るため数十秒かかることがある。編集フォームでその完了を
  // 待たせず、対象のエントリ自体に「処理中」を示す（他のエントリの編集・閲覧は
  // その間もそのまま行える）。entryIdごとに管理するので、複数件を並行して
  // バックグラウンド処理してもよい。
  const [pendingEntryIds, setPendingEntryIds] = useState<Set<string>>(new Set());
  const [pendingEntryErrors, setPendingEntryErrors] = useState<Record<string, { message: string; retry: () => void }>>(
    {},
  );

  function isEntryPending(entryId: string): boolean {
    // 編集フォームを開いたまま行うclearResolutionのように、フォームを閉じずに
    // 待つ操作もあるため、そのエントリを現在編集中の間はスピナーカードにはしない
    // （フォーム内のeditSubmittingがその間の状態を示す）。
    return pendingEntryIds.has(entryId) && editingEntryId !== entryId;
  }

  function dismissPendingError(entryId: string) {
    setPendingEntryErrors((prev) => {
      if (!(entryId in prev)) return prev;
      const next = { ...prev };
      delete next[entryId];
      return next;
    });
  }

  function startEditing(entry: JournalEntry) {
    setEditingEntryId(entry.id);
    setEditRawText(entry.rawText);
    setRawTextTouched(false);
    setEditTags(entry.tags.join(", "));
    setEditPeople(entry.people.join(", "));
    setEditTeams((entry.teamNames ?? []).join(", "));
    setEditUrgency(entry.urgency);
    setEditSentiment(entry.sentiment);
    setEditDate(timestampToDateInputValue(entry.createdAt));
    setResolutionNoteDraft(entry.resolutionNote ?? "");
    setEditError(null);
    dismissPendingError(entry.id);
  }

  function cancelEditing() {
    setEditingEntryId(null);
  }

  function currentEditPatch() {
    return {
      rawText: rawTextTouched ? editRawText.trim() || undefined : undefined,
      tags: editTags.split(",").map((t) => t.trim()).filter(Boolean),
      people: editPeople.split(",").map((p) => p.trim()).filter(Boolean),
      teams: editTeams.split(",").map((t) => t.trim()).filter(Boolean),
      urgency: editUrgency,
      sentiment: editSentiment,
      occurredAtDate: editDate || undefined,
    };
  }

  // 実際のfetch＋state反映部分。entryIdの「処理中」フラグの出し入れとエラー記録を
  // ここに一本化する。呼び出し側（confirmEdit等）は、編集フォームを閉じてから
  // このawaitを待たずに呼ぶ（＝非ブロッキング）か、フォームを開いたまま
  // awaitするか（clearResolutionのように速い操作向け）を選べる。
  async function sendJournalPatch(
    entryId: string,
    body: Record<string, unknown>,
    retry: () => void,
  ): Promise<JournalEntry | undefined> {
    setPendingEntryIds((prev) => new Set(prev).add(entryId));
    dismissPendingError(entryId);
    try {
      const { res, data } = await fetchWithNameConfirm(
        `/api/journal/${entryId}`,
        { method: "PATCH", body },
        "保存する",
      );
      if (!res.ok) throw new Error((data as { error?: string } | null)?.error ?? "更新に失敗しました");
      // 修正はsupersedesで新しいイベント（＝新しいid）として記録されるため、
      // 古いエントリを新しい内容へ置き換える（一覧の並び順は変えない）。関数形式の
      // 更新を使い、待っている間にポーリングで変わった最新の配列を起点にする。
      setJournalEntries((prev) => prev.map((e) => (e.id === entryId ? (data as { entry: JournalEntry }).entry : e)));
      return (data as { entry: JournalEntry }).entry;
    } catch (err) {
      if ((err as Error).message !== "人名候補の確認をキャンセルしました") {
        setPendingEntryErrors((prev) => ({ ...prev, [entryId]: { message: (err as Error).message, retry } }));
      }
      return undefined;
    } finally {
      setPendingEntryIds((prev) => {
        const next = new Set(prev);
        next.delete(entryId);
        return next;
      });
    }
  }

  // tags/people/urgency/日付（必要なら本文）の確定。本文を触っていなければ
  // maskForStorageは走らないため通常は一瞬で終わるが、本文を編集した場合は
  // 他の更新と同じく時間がかかりうるので、待たずに編集フォームを閉じる。
  function confirmEdit(entryId: string) {
    const body = currentEditPatch();
    setEditingEntryId(null);
    const retry = () => {
      void sendJournalPatch(entryId, body, retry);
    };
    void sendJournalPatch(entryId, body, retry);
  }

  // docs/usage_issues U16。編集フォームを開かず、現在の抽出内容のまま確定する。
  // 自動分析ONかつフィルタ適合なら、サーバ側で初回確定時に分析が起動する。
  function confirmAsIs(entry: JournalEntry) {
    const body = {
      tags: entry.tags,
      people: entry.people,
      teamIds: entry.teamIds ?? [],
      urgency: entry.urgency,
      occurredAtDate: timestampToDateInputValue(entry.createdAt),
    };
    const retry = () => {
      void sendJournalPatch(entry.id, body, retry);
    };
    void sendJournalPatch(entry.id, body, retry);
  }

  // docs/usage_issues U16。確定済みJournalをフィルタ／自動設定に関係なく明示分析する。
  // 成功時は相談タブへ遷移できるよう runId を返す。
  async function startAnalysis(entry: JournalEntry): Promise<string | undefined> {
    setPendingEntryIds((prev) => new Set(prev).add(entry.id));
    dismissPendingError(entry.id);
    try {
      const { res, data } = await fetchWithNameConfirm(
        `/api/journal/${entry.id}/analyze`,
        { method: "POST", body: {} },
        "分析を開始する",
      );
      if (!res.ok) throw new Error((data as { error?: string } | null)?.error ?? "分析の起動に失敗しました");
      const payload = data as { entry: JournalEntry; run: { id: string } };
      setJournalEntries((prev) =>
        prev.map((e) => (e.id === entry.id ? { ...payload.entry, sourceConsultRunId: payload.run.id } : e)),
      );
      return payload.run.id;
    } catch (err) {
      if ((err as Error).message !== "人名候補の確認をキャンセルしました") {
        const retry = () => {
          void startAnalysis(entry);
        };
        setPendingEntryErrors((prev) => ({ ...prev, [entry.id]: { message: (err as Error).message, retry } }));
      }
      return undefined;
    } finally {
      setPendingEntryIds((prev) => {
        const next = new Set(prev);
        next.delete(entry.id);
        return next;
      });
    }
  }

  // 「メモを残して解決にする」: Issue化するほどではないが、この件はもう追いかけなくてよい、
  // という判断をJournal自体に記録する。urgencyは書き換えない（起きた出来事の深刻さの記録は
  // そのまま残す）。resolutionNoteはmaskForStorageを通るため時間がかかりうる。
  function resolveWithNote(entryId: string) {
    const note = resolutionNoteDraft.trim();
    if (!note) {
      setEditError("解決メモを入力してください");
      return;
    }
    const body = { ...currentEditPatch(), resolutionNote: note };
    setEditingEntryId(null);
    const retry = () => {
      void sendJournalPatch(entryId, body, retry);
    };
    void sendJournalPatch(entryId, body, retry);
  }

  // 「提案として残してこの件を追跡する」: 新規 Suggestion を作成し、紐付ける。
  async function resolveWithNewIssue(entry: JournalEntry): Promise<string | undefined> {
    setEditSubmitting(true);
    setEditError(null);
    try {
      const { res: issueRes, data: issueData } = await fetchWithNameConfirm(
        "/api/suggestions",
        {
          method: "POST",
          body: {
            title: truncateForTitle(entry.summary || entry.rawText),
            sourceJournalId: entry.id,
          },
        },
        "保存する",
      );
      if (!issueRes.ok) {
        throw new Error((issueData as { error?: string } | null)?.error ?? "提案の作成に失敗しました");
      }

      const suggestionId = (issueData as { suggestion: { id: string } }).suggestion.id;
      const { res, data } = await fetchWithNameConfirm(
        `/api/journal/${entry.id}`,
        {
          method: "PATCH",
          body: { ...currentEditPatch(), resolvedIssueId: suggestionId },
        },
        "保存する",
      );
      if (!res.ok) {
        throw new Error(
          (data as { error?: string } | null)?.error ?? "提案への紐付けに失敗しました（提案自体は作成されています）",
        );
      }
      setJournalEntries((prev) => prev.map((e) => (e.id === entry.id ? (data as { entry: JournalEntry }).entry : e)));
      setEditingEntryId(null);
      return suggestionId;
    } catch (err) {
      if ((err as Error).message !== "人名候補の確認をキャンセルしました") {
        setEditError((err as Error).message);
      }
      return undefined;
    } finally {
      setEditSubmitting(false);
    }
  }

  // 解決状態の取り消し（誤ってIssue化/メモした場合の巻き戻し）。編集フォームを
  // 閉じない操作であり、resolutionNote/rawTextを含まないため通常は速い。意図的に
  // sendJournalPatchは使わず、フォームを開いたままeditErrorでエラーを出す
  // （resolveWithNewIssueと同じ理由——編集中の他の入力を巻き込んでエラーカードに
  // 差し替えたくない）。
  async function clearResolution(entryId: string) {
    setEditSubmitting(true);
    setEditError(null);
    try {
      const { res, data } = await fetchWithNameConfirm(
        `/api/journal/${entryId}`,
        {
          method: "PATCH",
          body: { ...currentEditPatch(), resolvedIssueId: null, resolutionNote: null },
        },
        "保存する",
      );
      if (!res.ok) throw new Error((data as { error?: string } | null)?.error ?? "更新に失敗しました");
      setJournalEntries((prev) => prev.map((e) => (e.id === entryId ? (data as { entry: JournalEntry }).entry : e)));
    } catch (err) {
      if ((err as Error).message !== "人名候補の確認をキャンセルしました") {
        setEditError((err as Error).message);
      }
    } finally {
      setEditSubmitting(false);
    }
  }

  // ユーザー指摘「確認したが対応不要だった、を示せず#ネガティブ等の強調を減らせない」対応。
  // sentimentは観測値のまま書き換えず、EMが確認済み・対応不要と判断した事実だけを別途
  // 記録する専用エンドポイントを叩く（通常のPATCH/supersedesチェーンとは別経路）。
  // 頻度の低い操作であり、自由記述のノートを毎回求めると手間になるため、既定はメモなしの
  // ワンクリックにする（一覧側は確認済みの理由まで示す必要はなく、強調を弱めれば十分）。
  async function acknowledgeSentiment(entryId: string) {
    setPendingEntryIds((prev) => new Set(prev).add(entryId));
    dismissPendingError(entryId);
    try {
      const res = await fetch(`/api/journal/${entryId}/no-action-needed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "確認の記録に失敗しました");
      setJournalEntries((prev) => prev.map((e) => (e.id === entryId ? (data as { entry: JournalEntry }).entry : e)));
    } catch (err) {
      const retry = () => {
        void acknowledgeSentiment(entryId);
      };
      setPendingEntryErrors((prev) => ({ ...prev, [entryId]: { message: (err as Error).message, retry } }));
    } finally {
      setPendingEntryIds((prev) => {
        const next = new Set(prev);
        next.delete(entryId);
        return next;
      });
    }
  }

  async function clearSentimentAck(entryId: string) {
    setPendingEntryIds((prev) => new Set(prev).add(entryId));
    dismissPendingError(entryId);
    try {
      const res = await fetch(`/api/journal/${entryId}/no-action-needed`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "取り消しに失敗しました");
      setJournalEntries((prev) => prev.map((e) => (e.id === entryId ? (data as { entry: JournalEntry }).entry : e)));
    } catch (err) {
      const retry = () => {
        void clearSentimentAck(entryId);
      };
      setPendingEntryErrors((prev) => ({ ...prev, [entryId]: { message: (err as Error).message, retry } }));
    } finally {
      setPendingEntryIds((prev) => {
        const next = new Set(prev);
        next.delete(entryId);
        return next;
      });
    }
  }

  // docs/memo.md「相談、Journal、提案を削除（アーカイブ）したい」対応。内容の訂正
  // （PATCH/supersedesチェーン）とは別の専用エンドポイント（acknowledgeSentimentと同じ形）。
  async function archiveEntry(entryId: string) {
    setPendingEntryIds((prev) => new Set(prev).add(entryId));
    dismissPendingError(entryId);
    try {
      const res = await fetch(`/api/journal/${entryId}/archive`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "アーカイブに失敗しました");
      setJournalEntries((prev) => prev.map((e) => (e.id === entryId ? (data as { entry: JournalEntry }).entry : e)));
    } catch (err) {
      const retry = () => {
        void archiveEntry(entryId);
      };
      setPendingEntryErrors((prev) => ({ ...prev, [entryId]: { message: (err as Error).message, retry } }));
    } finally {
      setPendingEntryIds((prev) => {
        const next = new Set(prev);
        next.delete(entryId);
        return next;
      });
    }
  }

  async function unarchiveEntry(entryId: string) {
    setPendingEntryIds((prev) => new Set(prev).add(entryId));
    dismissPendingError(entryId);
    try {
      const res = await fetch(`/api/journal/${entryId}/archive`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "アーカイブ解除に失敗しました");
      setJournalEntries((prev) => prev.map((e) => (e.id === entryId ? (data as { entry: JournalEntry }).entry : e)));
    } catch (err) {
      const retry = () => {
        void unarchiveEntry(entryId);
      };
      setPendingEntryErrors((prev) => ({ ...prev, [entryId]: { message: (err as Error).message, retry } }));
    } finally {
      setPendingEntryIds((prev) => {
        const next = new Set(prev);
        next.delete(entryId);
        return next;
      });
    }
  }

  return {
    editingEntryId,
    editRawText,
    setEditRawText: (value: string) => {
      setEditRawText(value);
      setRawTextTouched(true);
    },
    editTags,
    setEditTags,
    editPeople,
    setEditPeople,
    editTeams,
    setEditTeams,
    editUrgency,
    setEditUrgency,
    editSentiment,
    setEditSentiment,
    editDate,
    setEditDate,
    editSubmitting,
    editError,
    startEditing,
    cancelEditing,
    confirmEdit,
    confirmAsIs,
    startAnalysis,
    resolutionNoteDraft,
    setResolutionNoteDraft,
    resolveWithNote,
    resolveWithNewIssue,
    clearResolution,
    acknowledgeSentiment,
    clearSentimentAck,
    archiveEntry,
    unarchiveEntry,
    isEntryPending,
    pendingEntryErrors,
    dismissPendingError,
    nameCandidateDialog,
  };
}
