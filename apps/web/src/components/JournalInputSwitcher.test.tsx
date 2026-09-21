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

  it("既定では「書く」見出しと随時メモの入力欄を表示する", () => {
    render(<JournalInputSwitcher onSaved={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "書く" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /他の取り込み方/ })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/1on1/)).toBeInTheDocument();
  });

  it("focusDumpIdがあればまとめて取り込むモードが既定で開く", () => {
    render(<JournalInputSwitcher onSaved={vi.fn()} focusDumpId="dump-1" />);
    expect(screen.getByText(/まとめて取り込む/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "← 随時メモに戻る" })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/1on1/)).not.toBeInTheDocument();
  });

  it("prefillがあれば随時メモが既定で開き、テキストが反映される", () => {
    render(<JournalInputSwitcher onSaved={vi.fn()} prefill="タスクAのメモ" />);
    expect(screen.getByRole("heading", { name: "書く" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("タスクAのメモ")).toBeInTheDocument();
  });

  it("他の取り込み方メニューから各入力モードに切り替わる", async () => {
    const user = userEvent.setup();
    render(<JournalInputSwitcher onSaved={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /他の取り込み方/ }));
    await user.click(screen.getByRole("menuitem", { name: /議事録ローカル要約/ }));
    expect(screen.getByPlaceholderText(/議事録やチャットログ等のテキストを貼り付けてください/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "← 随時メモに戻る" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /他の取り込み方/ }));
    await user.click(screen.getByRole("menuitem", { name: /まとめて取り込む/ }));
    expect(screen.getByText(/まとめて取り込む/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "← 随時メモに戻る" }));
    expect(screen.getByRole("heading", { name: "書く" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/1on1/)).toBeInTheDocument();
  });
});
