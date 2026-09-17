// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IdFragmentLink, IdResolveProvider } from "./IdFragmentLink";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

describe("IdFragmentLink", () => {
  beforeEach(() => {
    push.mockReset();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        json: async () => ({
          matches: [{ kind: "issue", id: "aaaaaaaa-1111-4111-8111-111111111111", label: "対象Issue", href: "/issues/aaaaaaaa-1111-4111-8111-111111111111" }],
        }),
      })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("サイドピーク向けコールバックがあれば Issue をピークで開く", async () => {
    const openIssueInPeek = vi.fn();
    const user = userEvent.setup();
    render(
      <IdResolveProvider openIssueInPeek={openIssueInPeek}>
        <IdFragmentLink fragment="aaaaaaaa">aaaaaaaa</IdFragmentLink>
      </IdResolveProvider>,
    );
    await user.click(screen.getByRole("link", { name: "aaaaaaaa" }));
    expect(openIssueInPeek).toHaveBeenCalledWith("aaaaaaaa-1111-4111-8111-111111111111");
    expect(push).not.toHaveBeenCalled();
  });

  it("ピーク外では router.push する", async () => {
    const user = userEvent.setup();
    render(<IdFragmentLink fragment="aaaaaaaa">aaaaaaaa</IdFragmentLink>);
    await user.click(screen.getByRole("link", { name: "aaaaaaaa" }));
    expect(push).toHaveBeenCalledWith("/issues/aaaaaaaa-1111-4111-8111-111111111111");
  });

  it("ホバー時に解決先のタイトルをカスタムツールチップ（data-tooltip）として表示する", async () => {
    const user = userEvent.setup();
    render(<IdFragmentLink fragment="aaaaaaaa">aaaaaaaa</IdFragmentLink>);
    const link = screen.getByRole("link", { name: "aaaaaaaa" });
    expect(link).not.toHaveAttribute("data-tooltip");

    await user.hover(link);
    expect(await screen.findByText((_, el) => el?.getAttribute("data-tooltip") === "対象Issue")).toBeTruthy();
  });

  it("複数候補がある場合はタイトルを改行区切りで並べる", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        json: async () => ({
          matches: [
            { kind: "issue", id: "aaaaaaaa-1111-4111-8111-111111111111", label: "候補1", href: "/issues/aaaaaaaa-1111-4111-8111-111111111111" },
            { kind: "journal", id: "aaaaaaaa-2222-4111-8111-111111111111", label: "候補2", href: "/journal?focus=aaaaaaaa-2222-4111-8111-111111111111" },
          ],
        }),
      })),
    );
    const user = userEvent.setup();
    render(<IdFragmentLink fragment="aaaaaaaa">aaaaaaaa</IdFragmentLink>);
    const link = screen.getByRole("link", { name: "aaaaaaaa" });
    await user.hover(link);
    expect(await screen.findByText((_, el) => el?.getAttribute("data-tooltip") === "候補1\n候補2")).toBeTruthy();
  });
});
