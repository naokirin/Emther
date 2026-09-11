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
});
