import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { ChatHistoryPanel } from "./ChatHistoryPanel";
import type { AgentRun } from "@emther/core/agent-runtime";

function renderPanel(props: React.ComponentProps<typeof ChatHistoryPanel>) {
  return render(
    <MemoryRouter>
      <ChatHistoryPanel {...props} />
    </MemoryRouter>,
  );
}

// web/src/components/chat/ChatHistoryPanel.tsx（Next.js版）には専用テストが元々無かったため
// 新規に追加する（フェーズ3.5 tier5 chatバッチ）。

function baseRun(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: "run-1",
    agentName: "Lead Agent",
    task: "相談したいことがある",
    status: "idle",
    log: [],
    totalCostUsd: 0,
    createdAt: 0,
    updatedAt: 0,
    origin: "manual",
    reviewed: true,
    ...overrides,
  };
}

function baseProps(overrides: Partial<React.ComponentProps<typeof ChatHistoryPanel>> = {}) {
  return {
    historyRuns: [],
    selectedId: null,
    staleRunIds: new Set<string>(),
    promotedRunIds: new Set<string>(),
    chatHistoryLoaded: true,
    pinError: null,
    showArchivedConsults: false,
    onChangeShowArchivedConsults: vi.fn(),
    archivedConsultCount: 0,
    onSelect: vi.fn(),
    onNewConsult: vi.fn(),
    ...overrides,
  };
}

describe("ChatHistoryPanel", () => {
  it("履歴が空でロード済みなら空メッセージを表示する", () => {
    renderPanel(baseProps());
    expect(screen.getByText("まだ相談履歴はありません。")).toBeInTheDocument();
  });

  it("未ロード中は読み込み中を表示する", () => {
    renderPanel(baseProps({ chatHistoryLoaded: false }));
    expect(screen.getByText("読み込み中…")).toBeInTheDocument();
  });

  it("履歴一覧を表示し、クリックでonSelectを呼ぶ", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    renderPanel(baseProps({ historyRuns: [baseRun()], onSelect }));
    await user.click(screen.getByText("相談したいことがある"));
    expect(onSelect).toHaveBeenCalledWith("run-1");
  });

  it("「新しい相談を始める」ボタンでonNewConsultを呼ぶ", async () => {
    const onNewConsult = vi.fn();
    const user = userEvent.setup();
    renderPanel(baseProps({ onNewConsult }));
    await user.click(screen.getByRole("button", { name: "＋ 新しい相談を始める" }));
    expect(onNewConsult).toHaveBeenCalledTimes(1);
  });

  it("pinErrorがあれば表示する", () => {
    renderPanel(baseProps({ pinError: "指定された相談が見つかりませんでした。" }));
    expect(screen.getByRole("alert")).toHaveTextContent("指定された相談が見つかりませんでした。");
  });

  it("アーカイブ済み表示のチェックボックスでonChangeShowArchivedConsultsを呼ぶ", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderPanel(baseProps({ onChangeShowArchivedConsults: onChange, archivedConsultCount: 3 }));
    expect(screen.getByText(/アーカイブ済みも表示する（3件）/)).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox"));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
