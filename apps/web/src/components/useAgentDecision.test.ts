import { describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useAgentDecision } from "./useAgentDecision";
import type { AgentRun } from "@emther/core/agent-runtime";

function baseRun(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: "run-1",
    agentName: "Lead Agent",
    task: "タスク",
    status: "yield",
    log: [],
    totalCostUsd: 0,
    createdAt: 0,
    updatedAt: 0,
    origin: "manual",
    reviewed: true,
    yieldRequest: { reason: "判断が必要", options: [{ id: "A", label: "選択肢A" }] },
    ...overrides,
  };
}

describe("useAgentDecision", () => {
  it("sendDecisionは成功したらmessage/選択をクリアしrefreshRunsを呼ぶ", async () => {
    const fetchWithNameConfirm = vi.fn().mockResolvedValue({ res: { ok: true }, data: {} });
    const refreshRuns = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useAgentDecision({ linkedRun: baseRun(), fetchWithNameConfirm, refreshRuns }),
    );

    act(() => result.current.setMessage("追加の相談"));
    await act(async () => {
      await result.current.sendDecision("追加の相談");
    });

    expect(fetchWithNameConfirm).toHaveBeenCalledWith(
      "/api/agents/run-1/decide",
      { method: "POST", body: { message: "追加の相談" } },
      "送信する",
    );
    expect(result.current.message).toBe("");
    expect(refreshRuns).toHaveBeenCalledTimes(1);
  });

  it("失敗時はdecideErrorを設定する", async () => {
    const fetchWithNameConfirm = vi.fn().mockResolvedValue({ res: { ok: false }, data: { error: "送信エラー" } });
    const refreshRuns = vi.fn();
    const { result } = renderHook(() =>
      useAgentDecision({ linkedRun: baseRun(), fetchWithNameConfirm, refreshRuns }),
    );

    await act(async () => {
      await result.current.sendDecision("メッセージ");
    });

    await waitFor(() => expect(result.current.decideError).toBe("送信エラー"));
    expect(refreshRuns).not.toHaveBeenCalled();
  });

  it("人名候補確認のキャンセルはdecideErrorに出さない", async () => {
    const fetchWithNameConfirm = vi.fn().mockRejectedValue(new Error("人名候補の確認をキャンセルしました"));
    const refreshRuns = vi.fn();
    const { result } = renderHook(() =>
      useAgentDecision({ linkedRun: baseRun(), fetchWithNameConfirm, refreshRuns }),
    );

    await act(async () => {
      await result.current.sendDecision("メッセージ");
    });

    expect(result.current.decideError).toBeNull();
  });

  it("handleConfirmOptionは選択中のOption内容でsendDecisionを呼ぶ", async () => {
    const fetchWithNameConfirm = vi.fn().mockResolvedValue({ res: { ok: true }, data: {} });
    const refreshRuns = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useAgentDecision({ linkedRun: baseRun(), fetchWithNameConfirm, refreshRuns }),
    );

    act(() => result.current.setSelectedOptionId("A"));
    await act(async () => {
      result.current.handleConfirmOption();
    });

    await waitFor(() =>
      expect(fetchWithNameConfirm).toHaveBeenCalledWith(
        "/api/agents/run-1/decide",
        { method: "POST", body: { message: "Option A（選択肢A）を採用します。この方針で進めてください。" } },
        "送信する",
      ),
    );
  });

  it("linkedRunが無ければsendDecisionは何もしない", async () => {
    const fetchWithNameConfirm = vi.fn();
    const refreshRuns = vi.fn();
    const { result } = renderHook(() =>
      useAgentDecision({ linkedRun: null, fetchWithNameConfirm, refreshRuns }),
    );

    await act(async () => {
      await result.current.sendDecision("メッセージ");
    });

    expect(fetchWithNameConfirm).not.toHaveBeenCalled();
  });
});
