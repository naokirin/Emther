import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TodayActionsPanel } from "./TodayActionsPanel";
import type { NextAction } from "../../lib/dashboard-next-actions";
import type { AgentRun } from "../RunDetail";

// web/src/components/dashboard/TodayActionsPanel.tsx（Next.js版）には専用テストが元々
// 無かったため新規に追加する（フェーズ3.5 tier5 dashboardバッチ）。AgentStatusSectionの
// 内部動作は別テストで検証済みのため、ここでは今日やるべき3つ・残り一覧・様子見一覧の
// 表示/操作に絞る。

function action(overrides: Partial<NextAction> & { id: string }): NextAction {
  return {
    severity: "urgent",
    lane: "decision",
    icon: "🔴",
    kindLabel: "実行異常",
    text: "テスト項目",
    onSelect: vi.fn(),
    since: Date.now(),
    ...overrides,
  };
}

function run(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: "run-1",
    agentName: "Lead Agent",
    task: "様子見中のタスク",
    status: "idle",
    log: [],
    totalCostUsd: 0,
    createdAt: 0,
    updatedAt: 0,
    origin: "manual",
    reviewed: true,
    triageStatus: "watching",
    ...overrides,
  };
}

function baseProps(overrides: Partial<React.ComponentProps<typeof TodayActionsPanel>> = {}): React.ComponentProps<typeof TodayActionsPanel> {
  return {
    now: Date.now(),
    nextActions: [],
    nextActionsLoaded: true,
    decisionQueueLimit: 3,
    observationQueueLimit: 3,
    watchingItems: [],
    lastSeenAt: null,
    unlinkedParentCount: 0,
    autoRunsToday: 0,
    runs: [],
    runsLoaded: true,
    onNavigate: vi.fn(),
    suggestionLinkSuggesting: false,
    suggestionLinkError: null,
    suggestionLinkPreview: null,
    suggestionLinkApplyingId: null,
    onSuggestSuggestionStrategyLinks: vi.fn(),
    onAdoptSuggestionStrategyLink: vi.fn(),
    onDismissSuggestionLinkPreview: vi.fn(),
    onDismissSuggestionLinkOne: vi.fn(),
    ...overrides,
  };
}

describe("TodayActionsPanel", () => {
  it("未ロード中は読み込み中を見出しにする", () => {
    render(<TodayActionsPanel {...baseProps({ nextActionsLoaded: false })} />);
    expect(screen.getByRole("heading", { name: "読み込み中…" })).toBeInTheDocument();
  });

  it("アクションが無ければ判断待ちの組織課題はありませんと表示する", () => {
    render(<TodayActionsPanel {...baseProps()} />);
    expect(screen.getByRole("heading", { name: /判断待ちの組織課題はありません/ })).toBeInTheDocument();
  });

  it("上位3件を今日やるべき3つとして表示し、クリックでonSelectを呼ぶ", async () => {
    const onSelect1 = vi.fn();
    const user = userEvent.setup();
    const actions = [
      action({ id: "a1", text: "1件目", onSelect: onSelect1 }),
      action({ id: "a2", text: "2件目" }),
      action({ id: "a3", text: "3件目" }),
    ];
    render(<TodayActionsPanel {...baseProps({ nextActions: actions })} />);
    expect(screen.getByRole("heading", { name: "🎯 今日やるべき3つ" })).toBeInTheDocument();
    await user.click(screen.getByText(/1件目/));
    expect(onSelect1).toHaveBeenCalledTimes(1);
  });

  it("4件目以降は「ほかに」ボタンでレーン別に開ける", async () => {
    const user = userEvent.setup();
    const actions = [
      action({ id: "a1" }),
      action({ id: "a2" }),
      action({ id: "a3" }),
      action({ id: "a4", text: "4件目", lane: "observation" }),
    ];
    render(<TodayActionsPanel {...baseProps({ nextActions: actions })} />);
    const moreButton = screen.getByText(/ほかに 1 件/);
    await user.click(moreButton);
    await user.click(screen.getByRole("button", { name: /観測不足（1）/ }));
    expect(screen.getByText("4件目")).toBeInTheDocument();
  });

  it("様子見中の一覧をトグルできる", async () => {
    const user = userEvent.setup();
    render(<TodayActionsPanel {...baseProps({ watchingItems: [run()] })} />);
    expect(screen.queryByText("様子見中のタスク")).not.toBeInTheDocument();
    await user.click(screen.getByText(/様子見中（1件）を見る/));
    expect(screen.getByText("様子見中のタスク")).toBeInTheDocument();
  });

  it("戦略未接続の親提案があれば警告バナーとAI見直しボタンを表示する", async () => {
    const onSuggest = vi.fn();
    const user = userEvent.setup();
    render(<TodayActionsPanel {...baseProps({ unlinkedParentCount: 2, onSuggestSuggestionStrategyLinks: onSuggest })} />);
    expect(screen.getByText(/戦略未接続の親 提案 が 2 件あります/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "AIで見直す" }));
    expect(onSuggest).toHaveBeenCalledTimes(1);
  });
});
