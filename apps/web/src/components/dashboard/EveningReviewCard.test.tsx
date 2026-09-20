import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EveningReviewCard } from "./EveningReviewCard";

describe("EveningReviewCard", () => {
  it("読み込み中は「読み込み中…」を表示する", () => {
    render(<EveningReviewCard checkinsLoaded={false} hasCheckinToday={false} onStart={vi.fn()} />);
    expect(screen.getByText("読み込み中…")).toBeInTheDocument();
  });

  it("当日未記録なら警告を表示する", () => {
    render(<EveningReviewCard checkinsLoaded={true} hasCheckinToday={false} onStart={vi.fn()} />);
    expect(screen.getByText(/まだ今日のチェックイン/)).toBeInTheDocument();
  });

  it("当日記録済みなら警告を表示しない", () => {
    render(<EveningReviewCard checkinsLoaded={true} hasCheckinToday={true} onStart={vi.fn()} />);
    expect(screen.queryByText(/まだ今日のチェックイン/)).not.toBeInTheDocument();
  });

  it("はじめるボタンでonStartが呼ばれる", async () => {
    const user = userEvent.setup();
    const onStart = vi.fn();
    render(<EveningReviewCard checkinsLoaded={true} hasCheckinToday={true} onStart={onStart} />);
    await user.click(screen.getByRole("button", { name: "はじめる" }));
    expect(onStart).toHaveBeenCalled();
  });
});
