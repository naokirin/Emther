import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { HelpPage } from "./HelpPage";

describe("HelpPage（docs/2nd_architecture/plan.md フェーズ3.5 tier1）", () => {
  it("見出し・目次・戻るリンクを表示する", () => {
    render(
      <MemoryRouter>
        <HelpPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { name: "ヘルプ" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "画面の使い分け" })).toHaveAttribute("href", "#overview");
    expect(screen.getByRole("link", { name: "← 今日へ戻る" })).toHaveAttribute("href", "/");
  });
});
