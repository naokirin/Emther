import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "@/router";
import { SuggestionLink } from "./SuggestionLink";
import { IdResolveProvider } from "./IdFragmentLink";

describe("SuggestionLink", () => {
  it("通常クリックではpeek.openを呼び、遷移しない", async () => {
    const openSuggestionInPeek = vi.fn();
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <IdResolveProvider openSuggestionInPeek={openSuggestionInPeek}>
          <SuggestionLink id="sug-1">提案タイトル</SuggestionLink>
        </IdResolveProvider>
      </MemoryRouter>,
    );
    const link = screen.getByRole("link", { name: "提案タイトル" });
    expect(link).toHaveAttribute("href", "/suggestions/sug-1");
    await user.click(link);
    expect(openSuggestionInPeek).toHaveBeenCalledWith("sug-1");
  });

  it("修飾キー付きクリックではpeek.openを呼ばない（通常のリンク遷移に任せる）", async () => {
    const openSuggestionInPeek = vi.fn();
    render(
      <MemoryRouter>
        <IdResolveProvider openSuggestionInPeek={openSuggestionInPeek}>
          <SuggestionLink id="sug-1">提案タイトル</SuggestionLink>
        </IdResolveProvider>
      </MemoryRouter>,
    );
    const link = screen.getByRole("link", { name: "提案タイトル" });
    link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, metaKey: true }));
    expect(openSuggestionInPeek).not.toHaveBeenCalled();
  });
});
