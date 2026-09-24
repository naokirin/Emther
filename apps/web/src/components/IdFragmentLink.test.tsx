import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "@/router";
import { IdFragmentLink, IdResolveProvider } from "./IdFragmentLink";

function LocationProbe() {
  return <div data-testid="location">{useLocation().pathname}</div>;
}

// MemoryRouter 上で遷移後のパスを検証する
describe("IdFragmentLink", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        json: async () => ({
          matches: [{ kind: "suggestion", id: "aaaaaaaa-1111-4111-8111-111111111111", label: "対象提案", href: "/suggestions/aaaaaaaa-1111-4111-8111-111111111111" }],
        }),
      })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("サイドピーク向けコールバックがあれば提案をピークで開く", async () => {
    const openSuggestionInPeek = vi.fn();
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <IdResolveProvider openSuggestionInPeek={openSuggestionInPeek}>
          <IdFragmentLink fragment="aaaaaaaa">aaaaaaaa</IdFragmentLink>
        </IdResolveProvider>
      </MemoryRouter>,
    );
    await user.click(screen.getByRole("link", { name: "aaaaaaaa" }));
    expect(openSuggestionInPeek).toHaveBeenCalledWith("aaaaaaaa-1111-4111-8111-111111111111");
  });

  it("ピーク外では解決先へ遷移する", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/start"]}>
        <IdFragmentLink fragment="aaaaaaaa">aaaaaaaa</IdFragmentLink>
        <LocationProbe />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole("link", { name: "aaaaaaaa" }));
    expect(await screen.findByTestId("location")).toHaveTextContent("/suggestions/aaaaaaaa-1111-4111-8111-111111111111");
  });

  it("ホバー時に解決先のタイトルをカスタムツールチップ（data-tooltip）として表示する", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <IdFragmentLink fragment="aaaaaaaa">aaaaaaaa</IdFragmentLink>
      </MemoryRouter>,
    );
    const link = screen.getByRole("link", { name: "aaaaaaaa" });
    expect(link).not.toHaveAttribute("data-tooltip");

    await user.hover(link);
    expect(await screen.findByText((_, el) => el?.getAttribute("data-tooltip") === "対象提案")).toBeTruthy();
  });

  it("複数候補がある場合はタイトルを改行区切りで並べる", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        json: async () => ({
          matches: [
            { kind: "suggestion", id: "aaaaaaaa-1111-4111-8111-111111111111", label: "候補1", href: "/suggestions/aaaaaaaa-1111-4111-8111-111111111111" },
            { kind: "journal", id: "aaaaaaaa-2222-4111-8111-111111111111", label: "候補2", href: "/journal?focus=aaaaaaaa-2222-4111-8111-111111111111" },
          ],
        }),
      })),
    );
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <IdFragmentLink fragment="aaaaaaaa">aaaaaaaa</IdFragmentLink>
      </MemoryRouter>,
    );
    const link = screen.getByRole("link", { name: "aaaaaaaa" });
    await user.hover(link);
    expect(await screen.findByText((_, el) => el?.getAttribute("data-tooltip") === "候補1\n候補2")).toBeTruthy();
  });

  it("<p> タグ内で未一致モーダルを開いたとき、Modalがdocument.bodyにポータル描画される", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        json: async () => ({ matches: [] }),
      })),
    );
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <p data-testid="paragraph">
          プレフィックス参照: <IdFragmentLink fragment="notfound">notfound</IdFragmentLink>
        </p>
      </MemoryRouter>,
    );
    await user.click(screen.getByRole("link", { name: "notfound" }));
    const dialog = await screen.findByRole("dialog", { name: "一致する項目がありません" });
    expect(dialog).toBeInTheDocument();

    const paragraph = screen.getByTestId("paragraph");
    expect(paragraph.contains(dialog)).toBe(false);
    expect(document.body.contains(dialog)).toBe(true);
  });
});
