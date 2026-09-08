// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Modal } from "./Modal";

describe("Modal", () => {
  it("role=dialog・aria-modal・タイトルとの紐付けを持つ", () => {
    render(
      <Modal title="Issueを起票" onClose={vi.fn()}>
        <p>本文</p>
      </Modal>,
    );
    const dialog = screen.getByRole("dialog", { name: "Issueを起票" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });

  it("開いた瞬間にダイアログ本体へフォーカスを移す", () => {
    render(
      <Modal title="タイトル" onClose={vi.fn()}>
        <button>中の要素</button>
      </Modal>,
    );
    expect(screen.getByRole("dialog")).toHaveFocus();
  });

  it("閉じるボタンでonCloseが呼ばれる", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <Modal title="タイトル" onClose={onClose}>
        <p>本文</p>
      </Modal>,
    );
    await user.click(screen.getByRole("button", { name: "閉じる" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("オーバーレイクリックでonCloseが呼ばれるが、ダイアログ本体クリックでは呼ばれない", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <Modal title="タイトル" onClose={onClose}>
        <p>本文</p>
      </Modal>,
    );
    await user.click(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();

    // オーバーレイ自体（ダイアログの外側）をクリックする。
    const overlay = screen.getByRole("dialog").parentElement!;
    await user.click(overlay);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Escapeキーで閉じる", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <Modal title="タイトル" onClose={onClose}>
        <p>本文</p>
      </Modal>,
    );
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Tabでフォーカスをダイアログ内でループさせる（フォーカストラップ）", async () => {
    const user = userEvent.setup();
    render(
      <Modal title="タイトル" onClose={vi.fn()}>
        <button>最初のボタン</button>
        <button>最後のボタン</button>
      </Modal>,
    );
    const last = screen.getByRole("button", { name: "最後のボタン" });
    // ×閉じるボタンが実際にはDOM順でtitleの後に来るため、フォーカス可能要素の並びは
    // [閉じるボタン, 最初のボタン, 最後のボタン]になる。最後の要素からTabで先頭に戻る。
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
      <Modal title="タイトル" onClose={vi.fn()}>
        <p>本文</p>
      </Modal>,
    );
    expect(screen.getByRole("dialog")).toHaveFocus();
    unmount();
    expect(opener).toHaveFocus();
    opener.remove();
  });
});
