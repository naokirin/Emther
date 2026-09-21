import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EveningReviewCard } from "./EveningReviewCard";

describe("EveningReviewCard", () => {
  it("読み込み中は何も出さない", () => {
    const { container } = render(
      <EveningReviewCard checkinsLoaded={false} hasCheckinToday={false} onStart={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("当日未記録なら薄い帯を表示する", () => {
    render(<EveningReviewCard checkinsLoaded={true} hasCheckinToday={false} onStart={vi.fn()} />);
    expect(screen.getByText(/まだ今日のチェックイン未記録/)).toBeInTheDocument();
  });

  it("当日記録済みなら何も出さない", () => {
    const { container } = render(
      <EveningReviewCard checkinsLoaded={true} hasCheckinToday={true} onStart={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("はじめるボタンでonStartが呼ばれる", async () => {
    const user = userEvent.setup();
    const onStart = vi.fn();
    render(<EveningReviewCard checkinsLoaded={true} hasCheckinToday={false} onStart={onStart} />);
    await user.click(screen.getByRole("button", { name: "はじめる" }));
    expect(onStart).toHaveBeenCalled();
  });
});
