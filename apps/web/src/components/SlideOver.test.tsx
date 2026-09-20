import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { SlideOver } from "./SlideOver";

afterEach(() => {
  window.localStorage.clear();
});

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
    // DOM上の最後のフォーカス対象は、幅変更ハンドル（role="separator"）。
    // ここからのTabで先頭（閉じるボタン）へ戻ることを確認する。
    const last = screen.getByRole("separator", { name: "パネルの幅を変更" });
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
      <MemoryRouter>
        <SlideOver title="タイトル" onClose={vi.fn()} detailHref="/issues/123">
          <p>本文</p>
        </SlideOver>
      </MemoryRouter>,
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

  it("幅変更ハンドルの←→キーで幅（インラインstyle）が変わる", async () => {
    const user = userEvent.setup();
    render(
      <SlideOver title="タイトル" onClose={vi.fn()}>
        <p>本文</p>
      </SlideOver>,
    );
    const handle = screen.getByRole("separator", { name: "パネルの幅を変更" });
    const box = screen.getByRole("dialog");
    const initialWidth = box.style.width;
    handle.focus();
    await user.keyboard("{ArrowLeft}");
    expect(box.style.width).not.toBe(initialWidth);
    expect(parseInt(box.style.width, 10)).toBeGreaterThan(parseInt(initialWidth, 10));
  });

  // ユーザー指摘「サイドピークを開くとhydration mismatchのコンソールエラーが出る」対応。
  // 保存済みの幅がDEFAULT_WIDTHと異なっていても、初回描画（SSRと揃えるべき瞬間）は
  // 必ずDEFAULT_WIDTHになり、マウント後に保存値へ切り替わることを確認する。
  it("保存済みの幅がDEFAULT_WIDTHと異なっていても、初回描画はDEFAULT_WIDTHになり、直後に保存値へ切り替わる", async () => {
    window.localStorage.setItem("em-slideover-width", "909");
    render(
      <SlideOver title="タイトル" onClose={vi.fn()}>
        <p>本文</p>
      </SlideOver>,
    );
    const box = screen.getByRole("dialog");
    await waitFor(() => expect(box.style.width).toBe("909px"));
  });
});
