import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SetupGapsBanner } from "./SetupGapsBanner";

describe("SetupGapsBanner", () => {
  it("setupGapsが空なら何も描画しない", () => {
    const { container } = render(
      <SetupGapsBanner setupGaps={[]} teamsCount={1} hasMvv onNavigate={vi.fn()} goalsCount={1} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("teamsCountが0なら「チームへ」ボタンを表示する", async () => {
    const onNavigate = vi.fn();
    const user = userEvent.setup();
    render(
      <SetupGapsBanner setupGaps={["Team 0件"]} teamsCount={0} hasMvv goalsCount={1} onNavigate={onNavigate} />,
    );
    await user.click(screen.getByRole("button", { name: "チームへ" }));
    expect(onNavigate).toHaveBeenCalledWith("/teams");
  });

  it("MVV未設定ならジャーナル・相談・方針・目標への導線を出す", async () => {
    const onNavigate = vi.fn();
    const user = userEvent.setup();
    render(
      <SetupGapsBanner setupGaps={["MVV未設定"]} teamsCount={1} hasMvv={false} goalsCount={0} onNavigate={onNavigate} />,
    );
    expect(screen.getByText(/主経路は観測・相談から/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "ジャーナルで考える" }));
    expect(onNavigate).toHaveBeenCalledWith("/journal");
    await user.click(screen.getByRole("button", { name: "相談で考える" }));
    expect(onNavigate).toHaveBeenCalledWith("/chat");
    await user.click(screen.getByRole("button", { name: "方針・目標に置く" }));
    expect(onNavigate).toHaveBeenCalledWith("/org");
  });

  it("setupGapsの内容を・区切りで表示する", () => {
    render(
      <SetupGapsBanner setupGaps={["MVV未設定", "Team 0件"]} teamsCount={0} hasMvv={false} goalsCount={0} onNavigate={vi.fn()} />,
    );
    expect(screen.getByText(/MVV未設定・Team 0件/)).toBeInTheDocument();
  });
});
