import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AgentStatusSection, extractRecentActivities, formatActivityTime } from "./AgentStatusSection";
import type { AgentRun } from "../RunDetail";

function createRun(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: "run-1",
    agentName: "People Partner",
    task: "1on1の振り返りと課題整理",
    status: "idle",
    log: [
      { ts: Date.parse("2026-09-18T10:30:00"), text: "1on1ログから重要シグナルを抽出しました", channel: "system" },
      { ts: Date.parse("2026-09-18T10:35:00"), text: "メンバーAのモチベーション変化を検知", channel: "agent" },
    ],
    totalCostUsd: 0,
    createdAt: Date.parse("2026-09-18T10:00:00"),
    updatedAt: Date.parse("2026-09-18T10:35:00"),
    origin: "manual",
    reviewed: true,
    ...overrides,
  };
}

describe("AgentStatusSection", () => {
  const now = Date.parse("2026-09-18T12:00:00");

  it("formatActivityTime formats same-day timestamps as HH:mm", () => {
    expect(formatActivityTime(Date.parse("2026-09-18T09:15:00"), now)).toBe("09:15");
    expect(formatActivityTime(Date.parse("2026-09-17T09:15:00"), now)).toBe("09/17 09:15");
  });

  it("extractRecentActivities extracts log lines in reverse chronological order up to limit", () => {
    const run1 = createRun();
    const run2 = createRun({
      id: "run-2",
      agentName: "Org Designer",
      log: [
        { ts: Date.parse("2026-09-18T11:00:00"), text: "組織テーマの整合性をチェック", channel: "meta" },
      ],
    });

    const activities = extractRecentActivities([run1, run2], 2, now);
    expect(activities).toHaveLength(2);
    expect(activities[0].agentLabel).toBe("Org Designer");
    expect(activities[0].text).toContain("組織テーマの整合性をチェック");
    expect(activities[1].agentLabel).toBe("People Partner");
    expect(activities[1].text).toContain("メンバーAのモチベーション変化を検知");
  });

  it("renders idle state with recent movements when runsLoaded is true", () => {
    const onNavigate = vi.fn();
    const run = createRun();

    render(
      <AgentStatusSection
        runs={[run]}
        runsLoaded={true}
        autoRunsToday={2}
        onNavigate={onNavigate}
        now={now}
      />,
    );

    expect(screen.getByText(/🟢 待機中（正常稼働）/)).toBeInTheDocument();
    expect(screen.getByText(/本日自動起動: 2件/)).toBeInTheDocument();
    expect(screen.getByText(/メンバーAのモチベーション変化を検知/)).toBeInTheDocument();
    expect(screen.getByText("エージェント一覧・全ログ →")).toBeInTheDocument();
  });

  it("renders active count when an agent is active or queued", () => {
    const onNavigate = vi.fn();
    const run = createRun({ status: "active" });

    render(
      <AgentStatusSection
        runs={[run]}
        runsLoaded={true}
        autoRunsToday={0}
        onNavigate={onNavigate}
        now={now}
      />,
    );

    expect(screen.getByText(/🔵 1件実行中/)).toBeInTheDocument();
  });

  it("collapses and expands recent activities when toggled", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    const run = createRun();

    render(
      <AgentStatusSection
        runs={[run]}
        runsLoaded={true}
        autoRunsToday={1}
        onNavigate={onNavigate}
        now={now}
      />,
    );

    expect(screen.getByText(/メンバーAのモチベーション変化を検知/)).toBeInTheDocument();
    const toggleBtn = screen.getByText("折りたたむ");
    await user.click(toggleBtn);

    expect(screen.queryByText(/メンバーAのモチベーション変化を検知/)).not.toBeInTheDocument();
    expect(screen.getByText("動きを表示")).toBeInTheDocument();

    await user.click(screen.getByText("動きを表示"));
    expect(screen.getByText(/メンバーAのモチベーション変化を検知/)).toBeInTheDocument();
  });

  it("navigates to chat when an activity item is clicked", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    const run = createRun();

    render(
      <AgentStatusSection
        runs={[run]}
        runsLoaded={true}
        autoRunsToday={0}
        onNavigate={onNavigate}
        now={now}
      />,
    );

    const activityItem = screen.getByText(/メンバーAのモチベーション変化を検知/);
    await user.click(activityItem);

    expect(onNavigate).toHaveBeenCalledWith(`/chat?runId=${run.id}`);
  });
});
