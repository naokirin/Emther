import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { HelpLink, PageTitleRow } from "./HelpLink";

describe("HelpLink", () => {
  it("指定したアンカーへの/helpリンクを表示する", () => {
    render(
      <MemoryRouter>
        <HelpLink anchor="reflection" />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "ヘルプ" })).toHaveAttribute("href", "/help#reflection");
  });
});

describe("PageTitleRow", () => {
  it("タイトルとヘルプリンクを表示する", () => {
    render(
      <MemoryRouter>
        <PageTitleRow title="1日の締めくくり" helpAnchor="reflection" />
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { name: "1日の締めくくり" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ヘルプ" })).toHaveAttribute("href", "/help#reflection");
  });
});
