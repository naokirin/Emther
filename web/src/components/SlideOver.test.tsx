// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SlideOver } from "./SlideOver";

describe("SlideOver", () => {
  it("role=dialog・aria-modal・タイトルとの紐付けを持つ", () => {
    render(
      <SlideOver title="テストIssue" onClose={vi.fn()}>
        <p>本文</p>
      </SlideOver>,
    );
    const dialog = screen.getByRole("dialog", { name: "テストIssue" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });

  it("開いた瞬間にダイアログ本体へフォーカスを移す", () => {
    render(
      <SlideOver title="タイトル" onClose={vi.fn()}>
        <button>中の要素</button>
      </SlideOver>,
    );
    expect(screen.getByRole("dialog")).toHaveFocus();
  });

  it("閉じるボタンでonCloseが呼ばれる", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <SlideOver title="タイトル" onClose={onClose}>
        <p>本文</p>
      </SlideOver>,
    );
    await user.click(screen.getByRole("button", { name: "閉じる" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("オーバーレイクリックでonCloseが呼ばれるが、ダイアログ本体クリックでは呼ばれない", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <SlideOver title="タイトル" onClose={onClose}>
        <p>本文</p>
      </SlideOver>,
    );
    await user.click(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();

    const overlay = screen.getByRole("dialog").parentElement!;
    await user.click(overlay);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Escapeキーで閉じる", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <SlideOver title="タイトル" onClose={onClose}>
        <p>本文</p>
      </SlideOver>,
    );
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Tabでフォーカスをダイアログ内でループさせる（フォーカストラップ）", async () => {
    const user = userEvent.setup();
    render(
      <SlideOver title="タイトル" onClose={vi.fn()}>
        <button>最初のボタン</button>
        <button>最後のボタン</button>
      </SlideOver>,
    );
    const last = screen.getByRole("button", { name: "最後のボタン" });
    last.focus();
    await user.tab();
    expect(screen.getByRole("button", { name: "閉じる" })).toHaveFocus();
  });

  it("閉じた後、開く前にフォーカスしていた要素へフォーカスを戻す", () => {
    const opener = document.createElement("button");
    opener.textContent = "開くボタン";
    document.body.appendChild(opener);
    opener.focus();
    expect(opener).toHaveFocus();

    const { unmount } = render(
      <SlideOver title="タイトル" onClose={vi.fn()}>
        <p>本文</p>
      </SlideOver>,
    );
    expect(screen.getByRole("dialog")).toHaveFocus();
    unmount();
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it("detailHrefを渡すと「詳細画面で開く」リンクを表示する", () => {
    render(
      <SlideOver title="タイトル" onClose={vi.fn()} detailHref="/issues/123">
        <p>本文</p>
      </SlideOver>,
    );
    const link = screen.getByRole("link", { name: "詳細画面で開く" });
    expect(link).toHaveAttribute("href", "/issues/123");
  });

  it("detailHrefが無ければリンクを表示しない", () => {
    render(
      <SlideOver title="タイトル" onClose={vi.fn()}>
        <p>本文</p>
      </SlideOver>,
    );
    expect(screen.queryByRole("link", { name: "詳細画面で開く" })).not.toBeInTheDocument();
  });
});
