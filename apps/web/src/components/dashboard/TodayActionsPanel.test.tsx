import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TodayActionsPanel } from "./TodayActionsPanel";
import type { NextAction } from "../../lib/dashboard-next-actions";
import type { AgentRun } from "../RunDetail";

function action(overrides: Partial<NextAction> & { id: string }): NextAction {
  return {
    severity: "urgent",
    lane: "decision",
    icon: "🔴",
    kindLabel: "実行異常",
    text: "テスト項目",
    onSelect: vi.fn(),
    since: Date.now() - 5 * 24 * 60 * 60 * 1000,
    ctaLabel: "確認する",
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
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ items: [], source: "heuristic" }),
      }),
    );
  });

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
    expect(screen.getByRole("heading", { name: "今日やるべき3つ" })).toBeInTheDocument();
    await user.click(screen.getByText(/1件目/));
    expect(onSelect1).toHaveBeenCalledTimes(1);
  });

  it("4件目以降は「ほか」ボタンでレーン別に開ける", async () => {
    const user = userEvent.setup();
    const actions = [
      action({ id: "a1" }),
      action({ id: "a2" }),
      action({ id: "a3" }),
      action({ id: "a4", text: "4件目", lane: "observation" }),
    ];
    render(<TodayActionsPanel {...baseProps({ nextActions: actions })} />);
    await user.click(screen.getByText(/ほか 1 件をレーン別に見る/));
    await user.click(screen.getByRole("button", { name: /観測不足/ }));
    expect(screen.getByText(/4件目/)).toBeInTheDocument();
  });

  it("なぜ今APIを呼び、結果を表示する", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          items: [{ actionId: "a1", whyNow: "放置すると影響が広がる" }],
          source: "cloud",
        }),
      }),
    );
    render(
      <TodayActionsPanel
        {...baseProps({
          nextActions: [action({ id: "a1", text: "負荷が続いている" })],
        })}
      />,
    );
    expect(await screen.findByText(/なぜ今: 放置すると影響が広がる/)).toBeInTheDocument();
  });

  it("様子見リンクを出せる", async () => {
    const user = userEvent.setup();
    const actions = [
      action({ id: "a1" }),
      action({ id: "a2" }),
      action({ id: "a3" }),
      action({ id: "a4", text: "4件目" }),
    ];
    render(
      <TodayActionsPanel
        {...baseProps({
          nextActions: actions,
          watchingItems: [run()],
        })}
      />,
    );
    expect(screen.getByText(/様子見 1件/)).toBeInTheDocument();
    await user.click(screen.getByText(/様子見 1件/));
    expect(screen.getByRole("heading", { name: /様子見中（1件）/ })).toBeInTheDocument();
    expect(screen.getByText(/様子見.*にした相談/)).toBeInTheDocument();
  });

  it("緊急度バーを表示する", () => {
    render(
      <TodayActionsPanel
        {...baseProps({
          nextActions: [action({ id: "a1", text: "負荷が続いている", severity: "urgent" })],
        })}
      />,
    );
    expect(screen.getByText("緊急度")).toBeInTheDocument();
  });
});
