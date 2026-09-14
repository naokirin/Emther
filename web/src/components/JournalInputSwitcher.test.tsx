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

  it("既定では単発メモタブが選ばれ、入力欄が表示される", () => {
    render(<JournalInputSwitcher onSaved={vi.fn()} />);
    expect(screen.getByRole("button", { name: "📝 単発メモ" }).className).toContain("tabBtnActive");
    expect(screen.getByPlaceholderText(/1on1/)).toBeInTheDocument();
  });

  it("focusDumpIdがあればまとめて取り込むタブが既定で開く", () => {
    render(<JournalInputSwitcher onSaved={vi.fn()} focusDumpId="dump-1" />);
    expect(screen.getByRole("button", { name: "📥 まとめて取り込む" }).className).toContain("tabBtnActive");
    expect(screen.queryByPlaceholderText(/1on1/)).not.toBeInTheDocument();
  });

  it("タブをクリックすると表示が切り替わる", async () => {
    const user = userEvent.setup();
    render(<JournalInputSwitcher onSaved={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "📥 まとめて取り込む" }));
    expect(screen.queryByPlaceholderText(/1on1/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "📝 単発メモ" }));
    expect(screen.getByPlaceholderText(/1on1/)).toBeInTheDocument();
  });
});
