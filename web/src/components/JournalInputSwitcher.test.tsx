// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { JournalInputSwitcher } from "./JournalInputSwitcher";

describe("JournalInputSwitcher", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ dumps: [] }) })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("既定では「1日の振り返り」タブが選ばれ、リフレクション入力欄が表示される", () => {
    render(<JournalInputSwitcher onSaved={vi.fn()} />);
    expect(screen.getByRole("button", { name: "🌙 1日の振り返り" }).className).toContain("tabBtnActive");
    expect(screen.getByPlaceholderText(/今日はAさんと評価面談/)).toBeInTheDocument();
  });

  it("focusDumpIdがあればまとめて取り込むタブが既定で開く", () => {
    render(<JournalInputSwitcher onSaved={vi.fn()} focusDumpId="dump-1" />);
    expect(screen.getByRole("button", { name: "📥 まとめて取り込む" }).className).toContain("tabBtnActive");
    expect(screen.queryByPlaceholderText(/今日はAさんと評価面談/)).not.toBeInTheDocument();
  });

  it("タブをクリックすると各入力モードに切り替わる", async () => {
    const user = userEvent.setup();
    render(<JournalInputSwitcher onSaved={vi.fn()} />);

    // 随時メモ
    await user.click(screen.getByRole("button", { name: "📝 随時メモ" }));
    expect(screen.getByRole("button", { name: "📝 随時メモ" }).className).toContain("tabBtnActive");
    expect(screen.getByPlaceholderText(/1on1/)).toBeInTheDocument();

    // 議事録ローカル要約
    await user.click(screen.getByRole("button", { name: "🔒 議事録ローカル要約" }));
    expect(screen.getByRole("button", { name: "🔒 議事録ローカル要約" }).className).toContain("tabBtnActive");
    expect(screen.getByPlaceholderText(/議事録やチャットログ等のテキストを貼り付けてください/)).toBeInTheDocument();

    // まとめて取り込む
    await user.click(screen.getByRole("button", { name: "📥 まとめて取り込む" }));
    expect(screen.getByRole("button", { name: "📥 まとめて取り込む" }).className).toContain("tabBtnActive");

    // 1日の振り返りに戻す
    await user.click(screen.getByRole("button", { name: "🌙 1日の振り返り" }));
    expect(screen.getByRole("button", { name: "🌙 1日の振り返り" }).className).toContain("tabBtnActive");
    expect(screen.getByPlaceholderText(/今日はAさんと評価面談/)).toBeInTheDocument();
  });
});
