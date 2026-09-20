import { useState } from "react";
import type { AgentRun } from "./RunDetail";
import type { useNameCandidateConfirm } from "../lib/useNameCandidateConfirm";

type FetchWithNameConfirm = ReturnType<typeof useNameCandidateConfirm>["fetchWithNameConfirm"];

type Params = {
  linkedRun: AgentRun | null;
  fetchWithNameConfirm: FetchWithNameConfirm;
  refreshRuns: () => Promise<void>;
};

// ExecutionState の壁打ち（Yield選択・自由記述の送信）と CopilotChat の両方から使う
// 共有ロジック。docs/2nd_pivot_version.md Phase 7 で issue-detail から切り出し。
export function useAgentDecision({ linkedRun, fetchWithNameConfirm, refreshRuns }: Params) {
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [deciding, setDeciding] = useState(false);
  const [decideError, setDecideError] = useState<string | null>(null);

  async function sendDecision(text: string) {
    if (!linkedRun || !text.trim()) return;
    setDeciding(true);
    setDecideError(null);
    try {
      const { res, data } = await fetchWithNameConfirm(
        `/api/agents/${linkedRun.id}/decide`,
        { method: "POST", body: { message: text } },
        "送信する",
      );
      if (!res.ok) throw new Error((data as { error?: string } | null)?.error ?? "送信に失敗しました");
      setMessage("");
      setSelectedOptionId(null);
      await refreshRuns();
    } catch (err) {
      if ((err as Error).message !== "人名候補の確認をキャンセルしました") {
        setDecideError((err as Error).message);
      }
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

  return {
    selectedOptionId,
    setSelectedOptionId,
    message,
    setMessage,
    deciding,
    decideError,
    sendDecision,
    handleConfirmOption,
    handleFocusChat,
  };
}
