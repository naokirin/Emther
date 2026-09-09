// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MultiSelectAutocomplete, type MultiSelectOption } from "./MultiSelectAutocomplete";

const OPTIONS: MultiSelectOption[] = [
  { value: "a", label: "Team A" },
  { value: "b", label: "Team B" },
  { value: "c", label: "Engineering/Team A" },
];

describe("MultiSelectAutocomplete（表示）", () => {
  it("選択済みの値をタグとして表示する", () => {
    render(<MultiSelectAutocomplete values={["a"]} onChange={vi.fn()} options={OPTIONS} />);
    expect(screen.getByText("Team A")).toBeInTheDocument();
  });

  it("未入力の間は候補を出さない（大量の選択肢を並べない）", () => {
    render(<MultiSelectAutocomplete values={[]} onChange={vi.fn()} options={OPTIONS} />);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("選択済みが無ければplaceholderを表示し、選択済みがあれば表示しない", () => {
    const { rerender } = render(
      <MultiSelectAutocomplete values={[]} onChange={vi.fn()} options={OPTIONS} placeholder="検索…" />,
    );
    expect(screen.getByPlaceholderText("検索…")).toBeInTheDocument();
    rerender(<MultiSelectAutocomplete values={["a"]} onChange={vi.fn()} options={OPTIONS} placeholder="検索…" />);
    expect(screen.queryByPlaceholderText("検索…")).not.toBeInTheDocument();
  });
});

describe("MultiSelectAutocomplete（絞り込み・選択）", () => {
  it("入力すると部分一致する未選択の候補だけが出る", async () => {
    const user = userEvent.setup();
    render(<MultiSelectAutocomplete values={["a"]} onChange={vi.fn()} options={OPTIONS} />);
    await user.type(screen.getByRole("combobox"), "Team");
    const options = screen.getAllByRole("option");
    // "Team A"は既に選択済みなので候補に出ない。"Team B"・"Engineering/Team A"は出る。
    expect(options.map((o) => o.textContent)).toEqual(["Team B", "Engineering/Team A"]);
  });

  it("候補をクリックするとonChangeが呼ばれ、入力欄がクリアされる", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<MultiSelectAutocomplete values={[]} onChange={onChange} options={OPTIONS} />);
    const input = screen.getByRole("combobox");
    await user.type(input, "Team B");
    await user.click(screen.getByRole("option", { name: "Team B" }));
    expect(onChange).toHaveBeenCalledWith(["b"]);
    expect(input).toHaveValue("");
  });

  it("Enterで先頭の候補が選ばれる", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<MultiSelectAutocomplete values={[]} onChange={onChange} options={OPTIONS} />);
    await user.type(screen.getByRole("combobox"), "Team A");
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledWith(["a"]);
  });

  it("✕ボタンでタグを解除できる", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<MultiSelectAutocomplete values={["a", "b"]} onChange={onChange} options={OPTIONS} />);
    await user.click(screen.getByRole("button", { name: "Team Aを解除" }));
    expect(onChange).toHaveBeenCalledWith(["b"]);
  });

  it("入力欄が空の状態でBackspaceを押すと直近のタグを解除する", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<MultiSelectAutocomplete values={["a", "b"]} onChange={onChange} options={OPTIONS} />);
    screen.getByRole("combobox").focus();
    await user.keyboard("{Backspace}");
    expect(onChange).toHaveBeenCalledWith(["a"]);
  });

  it("外側をクリックすると候補一覧が閉じる（選択は変わらない）", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <div>
        <MultiSelectAutocomplete values={[]} onChange={onChange} options={OPTIONS} />
        <button type="button">outside</button>
      </div>,
    );
    await user.type(screen.getByRole("combobox"), "Team");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "outside" }));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });
});
