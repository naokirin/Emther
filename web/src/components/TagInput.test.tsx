// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TagInput } from "./TagInput";

describe("TagInput", () => {
  it("既存の値をタグとして表示する", () => {
    render(<TagInput values={["田中"]} onAdd={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getByText("田中")).toBeInTheDocument();
  });

  it("入力して追加ボタンを押すとonAddが呼ばれ、入力欄がクリアされる", async () => {
    const onAdd = vi.fn();
    const user = userEvent.setup();
    render(<TagInput values={[]} onAdd={onAdd} onRemove={vi.fn()} />);
    const input = screen.getByRole("textbox");
    await user.type(input, "田中");
    await user.click(screen.getByRole("button", { name: "追加" }));
    expect(onAdd).toHaveBeenCalledWith("田中");
    expect(input).toHaveValue("");
  });

  it("Enterキーでも追加できる", async () => {
    const onAdd = vi.fn();
    const user = userEvent.setup();
    render(<TagInput values={[]} onAdd={onAdd} onRemove={vi.fn()} />);
    await user.type(screen.getByRole("textbox"), "田中{Enter}");
    expect(onAdd).toHaveBeenCalledWith("田中");
  });

  it("空文字・空白のみは追加できない（追加ボタンが無効）", async () => {
    const user = userEvent.setup();
    render(<TagInput values={[]} onAdd={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getByRole("button", { name: "追加" })).toBeDisabled();
    await user.type(screen.getByRole("textbox"), "   ");
    expect(screen.getByRole("button", { name: "追加" })).toBeDisabled();
  });

  it("✕ボタンでonRemoveが呼ばれる", async () => {
    const onRemove = vi.fn();
    const user = userEvent.setup();
    render(<TagInput values={["田中", "佐藤"]} onAdd={vi.fn()} onRemove={onRemove} />);
    await user.click(screen.getByRole("button", { name: "田中を解除" }));
    expect(onRemove).toHaveBeenCalledWith("田中");
  });

  it("入力欄が空の状態でBackspaceを押すと直近のタグを解除する", async () => {
    const onRemove = vi.fn();
    const user = userEvent.setup();
    render(<TagInput values={["田中", "佐藤"]} onAdd={vi.fn()} onRemove={onRemove} />);
    screen.getByRole("textbox").focus();
    await user.keyboard("{Backspace}");
    expect(onRemove).toHaveBeenCalledWith("佐藤");
  });
});
