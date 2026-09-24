import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { todayDateInputValue } from "../recordDate";
import { api } from "../../lib/api-client";
import { reflectionNotesQueryKey, useReflectionNotes } from "../../lib/queries";
import type { EmReflectionNote, ReflectionNoteType } from "@emther/core/types";
import type { ReflectionNoteMutationResponse } from "@emther/api-contract";

export type ReflectionNoteController = ReturnType<typeof useReflectionNoteController>;

// growth/page.tsxのKPT入力欄と、夜の締めくくりフローの両方から使うため、
// EmCheckinWidgetのuseEmCheckinControllerと同じ「フォームと一覧表示でcontrollerを共有する」
// パターンに揃える。フォーム側だけ独立してuseReflectionNotes()を持つと、一覧側への反映が
// 次のポーリング（15秒間隔）まで遅延する回帰になるため、notesは必ずこのフックの
// 呼び出し元と共有すること。
export function useReflectionNoteController(onCreated?: (note: EmReflectionNote) => void) {
  const { notes, notesLoaded } = useReflectionNotes();
  const queryClient = useQueryClient();

  const [noteType, setNoteType] = useState<ReflectionNoteType>("keep");
  const [noteText, setNoteText] = useState("");
  const [noteDateOpen, setNoteDateOpen] = useState(false);
  const [noteCreatedAtDate, setNoteCreatedAtDate] = useState("");
  const [noteSubmitting, setNoteSubmitting] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);

  function resetNoteDate() {
    setNoteCreatedAtDate("");
    setNoteDateOpen(false);
  }

  // 1回の送信＝1件のメモ。typeは直前の選択を保ったままにする
  // （同じ種類のメモを立て続けに書きたい場面が多いため、毎回選び直させない）
  async function handleNoteSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!noteText.trim()) return;
    setNoteSubmitting(true);
    setNoteError(null);
    try {
      const res = await api.api["em-self"]["reflection-notes"].$post({
        json: {
          type: noteType,
          text: noteText,
          ...(noteCreatedAtDate ? { createdAtDate: noteCreatedAtDate } : {}),
        },
      });
      const data = (await res.json()) as ReflectionNoteMutationResponse & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "記録に失敗しました");
      queryClient.setQueryData<{ notes: EmReflectionNote[] }>(reflectionNotesQueryKey, () => ({
        notes: [data.note, ...notes],
      }));
      setNoteText("");
      resetNoteDate();
      onCreated?.(data.note);
    } catch (err) {
      setNoteError((err as Error).message);
    } finally {
      setNoteSubmitting(false);
    }
  }

  return {
    notes,
    notesLoaded,
    noteType,
    setNoteType,
    noteText,
    setNoteText,
    noteDateOpen,
    noteCreatedAtDate,
    openNoteDate: () => {
      setNoteCreatedAtDate((prev) => prev || todayDateInputValue());
      setNoteDateOpen(true);
    },
    setNoteCreatedAtDate,
    resetNoteDate,
    noteSubmitting,
    noteError,
    handleNoteSubmit,
  };
}
