import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { SuggestionLink } from "./SuggestionLink";
import { IdResolveProvider } from "./IdFragmentLink";

// web/src/components/SuggestionLink.tsx（Next.js版）には専用テストが元々無かったため
// 新規に追加する（フェーズ3.5 tier2、teamsバッチ）。
describe("SuggestionLink", () => {
  it("通常クリックではpeek.openを呼び、遷移しない", async () => {
    const openIssueInPeek = vi.fn();
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <IdResolveProvider openIssueInPeek={openIssueInPeek}>
          <SuggestionLink id="sug-1">提案タイトル</SuggestionLink>
        </IdResolveProvider>
      </MemoryRouter>,
    );
    const link = screen.getByRole("link", { name: "提案タイトル" });
    expect(link).toHaveAttribute("href", "/suggestions/sug-1");
    await user.click(link);
    expect(openIssueInPeek).toHaveBeenCalledWith("sug-1");
  });

  it("修飾キー付きクリックではpeek.openを呼ばない（通常のリンク遷移に任せる）", async () => {
    const openIssueInPeek = vi.fn();
    render(
      <MemoryRouter>
        <IdResolveProvider openIssueInPeek={openIssueInPeek}>
          <SuggestionLink id="sug-1">提案タイトル</SuggestionLink>
        </IdResolveProvider>
      </MemoryRouter>,
    );
    const link = screen.getByRole("link", { name: "提案タイトル" });
    link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, metaKey: true }));
    expect(openIssueInPeek).not.toHaveBeenCalled();
  });
});
