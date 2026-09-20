import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SetupGapsBanner } from "./SetupGapsBanner";

// web/src/components/dashboard/SetupGapsBanner.tsx（Next.js版）には専用テストが元々
// 無かったため新規に追加する（フェーズ3.5 tier5 dashboardバッチ）。

describe("SetupGapsBanner", () => {
  it("setupGapsが空なら何も描画しない", () => {
    const { container } = render(
      <SetupGapsBanner setupGaps={[]} teamsCount={1} hasMvv onNavigate={vi.fn()} objectivesCount={1} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("teamsCountが0なら「チームへ」ボタンを表示する", async () => {
    const onNavigate = vi.fn();
    const user = userEvent.setup();
    render(
      <SetupGapsBanner setupGaps={["Team 0件"]} teamsCount={0} hasMvv objectivesCount={1} onNavigate={onNavigate} />,
    );
    await user.click(screen.getByRole("button", { name: "チームへ" }));
    expect(onNavigate).toHaveBeenCalledWith("/teams");
  });

  it("MVV未設定またはObjective0件なら「方針・目標へ」ボタンを表示する", async () => {
    const onNavigate = vi.fn();
    const user = userEvent.setup();
    render(
      <SetupGapsBanner setupGaps={["MVV未設定"]} teamsCount={1} hasMvv={false} objectivesCount={0} onNavigate={onNavigate} />,
    );
    await user.click(screen.getByRole("button", { name: "方針・目標へ" }));
    expect(onNavigate).toHaveBeenCalledWith("/org");
  });

  it("setupGapsの内容を・区切りで表示する", () => {
    render(
      <SetupGapsBanner setupGaps={["MVV未設定", "Team 0件"]} teamsCount={0} hasMvv={false} objectivesCount={0} onNavigate={vi.fn()} />,
    );
    expect(screen.getByText(/MVV未設定・Team 0件/)).toBeInTheDocument();
  });
});
