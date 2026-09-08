// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IssueStatusBadge, IssueStatusSelector } from "./IssueStatus";

describe("IssueStatusBadge", () => {
  it("ステータスに応じたアイコン・ラベルを表示する", () => {
    render(<IssueStatusBadge status="blocked" />);
    expect(screen.getByText(/ブロッカーあり/)).toBeInTheDocument();
  });
});

describe("IssueStatusSelector", () => {
  it("4つのステータスボタンを表示し、現在のステータスは無効化する", () => {
    render(<IssueStatusSelector status="not_started" onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: /未着手/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /進行中/ })).not.toBeDisabled();
  });

  it("クリックでonChangeに選んだステータスを渡す", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<IssueStatusSelector status="not_started" onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: /ブロッカーあり/ }));
    expect(onChange).toHaveBeenCalledWith("blocked");
  });
});
