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

  it("既定では「随時メモ」タブが選ばれ、随時メモの入力欄が表示される", () => {
    render(<JournalInputSwitcher onSaved={vi.fn()} />);
    expect(screen.getByRole("button", { name: "📝 随時メモ" }).className).toContain("tabBtnActive");
    expect(screen.getByPlaceholderText(/1on1/)).toBeInTheDocument();
  });

  it("focusDumpIdがあればまとめて取り込むタブが既定で開く", () => {
    render(<JournalInputSwitcher onSaved={vi.fn()} focusDumpId="dump-1" />);
    expect(screen.getByRole("button", { name: "📥 まとめて取り込む" }).className).toContain("tabBtnActive");
    expect(screen.queryByPlaceholderText(/1on1/)).not.toBeInTheDocument();
  });

  it("prefillがあれば随時メモタブが既定で開き、テキストが反映される", () => {
    render(<JournalInputSwitcher onSaved={vi.fn()} prefill="タスクAのメモ" />);
    expect(screen.getByRole("button", { name: "📝 随時メモ" }).className).toContain("tabBtnActive");
    expect(screen.getByDisplayValue("タスクAのメモ")).toBeInTheDocument();
  });

  it("タブをクリックすると各入力モードに切り替わる", async () => {
    const user = userEvent.setup();
    render(<JournalInputSwitcher onSaved={vi.fn()} />);

    // 1日の振り返り
    await user.click(screen.getByRole("button", { name: "🌙 1日の振り返り" }));
    expect(screen.getByRole("button", { name: "🌙 1日の振り返り" }).className).toContain("tabBtnActive");
    expect(screen.getByRole("button", { name: "✨ 振り返りを始める" })).toBeInTheDocument();

    // 議事録ローカル要約
    await user.click(screen.getByRole("button", { name: "🔒 議事録ローカル要約" }));
    expect(screen.getByRole("button", { name: "🔒 議事録ローカル要約" }).className).toContain("tabBtnActive");
    expect(screen.getByPlaceholderText(/議事録やチャットログ等のテキストを貼り付けてください/)).toBeInTheDocument();

    // まとめて取り込む
    await user.click(screen.getByRole("button", { name: "📥 まとめて取り込む" }));
    expect(screen.getByRole("button", { name: "📥 まとめて取り込む" }).className).toContain("tabBtnActive");

    // 随時メモに戻す
    await user.click(screen.getByRole("button", { name: "📝 随時メモ" }));
    expect(screen.getByRole("button", { name: "📝 随時メモ" }).className).toContain("tabBtnActive");
    expect(screen.getByPlaceholderText(/1on1/)).toBeInTheDocument();
  });
});
