import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "@/router";
import { HelpPage } from "./HelpPage";

describe("HelpPage", () => {
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
