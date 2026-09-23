import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { usePagination } from "./usePagination";
import { todayDateInputValue } from "./recordDate";
import { api } from "../lib/api-client";
import { emCheckinsQueryKey, useEmCheckins } from "../lib/queries";
import type { EmCheckin } from "@emther/core/types";

const CHECKIN_PAGE_SIZE = 10;

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export type EmCheckinController = ReturnType<typeof useEmCheckinController>;

// /checkin では入力と履歴を別パネルに置くため、同じ状態をフォーム／履歴で共有する。
export function useEmCheckinController(onSubmitted?: (checkin: EmCheckin) => void) {
  const { checkins, checkinsLoaded } = useEmCheckins();
  const queryClient = useQueryClient();

  const [mood, setMood] = useState(3);
  const [energy, setEnergy] = useState(3);
  const [stress, setStress] = useState(3);
  const [headroom, setHeadroom] = useState(3);
  const [note, setNote] = useState("");
  const [dateOpen, setDateOpen] = useState(false);
  const [createdAtDate, setCreatedAtDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recentCheckins = checkins.slice(0, 7);
  const avgMood = average(recentCheckins.map((c) => c.mood));
  const avgEnergy = average(recentCheckins.map((c) => c.energy));
  const avgStress = average(recentCheckins.map((c) => c.stress));
  const avgHeadroom = average(
    recentCheckins.map((c) => c.headroom).filter((v): v is number => typeof v === "number"),
  );
  const checkinPagination = usePagination(checkins, CHECKIN_PAGE_SIZE);

  function resetDate() {
    setCreatedAtDate("");
    setDateOpen(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.api["em-self"].checkins.$post({
        json: {
          mood,
          energy,
          stress,
          headroom,
          note,
          ...(createdAtDate ? { createdAtDate } : {}),
        },
      });
      const data = (await res.json()) as { error?: string; checkin: EmCheckin };
      if (!res.ok) throw new Error(data.error ?? "記録に失敗しました");
      queryClient.setQueryData<{ checkins: EmCheckin[] }>(emCheckinsQueryKey, () => ({
        checkins: [data.checkin, ...checkins],
      }));
      setNote("");
      resetDate();
      onSubmitted?.(data.checkin);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return {
    mood,
    setMood,
    energy,
    setEnergy,
    stress,
    setStress,
    headroom,
    setHeadroom,
    note,
    setNote,
    dateOpen,
    createdAtDate,
    openDate: () => {
      setCreatedAtDate((prev) => prev || todayDateInputValue());
      setDateOpen(true);
    },
    setCreatedAtDate,
    resetDate,
    submitting,
    error,
    handleSubmit,
    recentCheckins,
    avgMood,
    avgEnergy,
    avgStress,
    avgHeadroom,
    checkinPagination,
    checkins,
    checkinsLoaded,
  };
}
