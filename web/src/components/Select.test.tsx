// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Select, type SelectOption } from "./Select";

const OPTIONS: SelectOption[] = [
  { value: "a", label: "Aさん" },
  { value: "b", label: "Bチーム" },
  { value: "c", label: "Cプロジェクト" },
];

describe("Select（閉じた状態）", () => {
  it("選択中の値のラベルを表示する", () => {
    render(<Select value="b" onChange={vi.fn()} options={OPTIONS} />);
    expect(screen.getByRole("combobox")).toHaveTextContent("Bチーム");
  });

  it("未選択（valueが選択肢に無い）ならplaceholderを表示する", () => {
    render(<Select value="" onChange={vi.fn()} options={OPTIONS} placeholder="なし" />);
    expect(screen.getByRole("combobox")).toHaveTextContent("なし");
  });

  it("disabledのときはボタンが無効化される", () => {
    render(<Select value="" onChange={vi.fn()} options={OPTIONS} disabled />);
    expect(screen.getByRole("combobox")).toBeDisabled();
  });
});

describe("Select（マウス操作）", () => {
  it("クリックでリストボックスを開閉する", async () => {
    const user = userEvent.setup();
    render(<Select value="" onChange={vi.fn()} options={OPTIONS} />);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    await user.click(screen.getByRole("combobox"));
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    await user.click(screen.getByRole("combobox"));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("選択肢をクリックするとonChangeが呼ばれ、リストが閉じる", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Select value="" onChange={onChange} options={OPTIONS} />);
    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByRole("option", { name: /Bチーム/ }));
    expect(onChange).toHaveBeenCalledWith("b");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("外側をクリックするとリストが閉じる（選択は変わらない）", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <div>
        <Select value="" onChange={onChange} options={OPTIONS} />
        <button type="button">outside</button>
      </div>,
    );
    await user.click(screen.getByRole("combobox"));
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "outside" }));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("選択中の選択肢にはチェックマークが付く", async () => {
    const user = userEvent.setup();
    render(<Select value="b" onChange={vi.fn()} options={OPTIONS} />);
    await user.click(screen.getByRole("combobox"));
    const selected = screen.getByRole("option", { name: /Bチーム/ });
    expect(within(selected).getByText("✓")).toBeInTheDocument();
    expect(selected).toHaveAttribute("aria-selected", "true");
  });
});

describe("Select（キーボード操作）", () => {
  it("ArrowDownで開き、Enterで確定する", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Select value="" onChange={onChange} options={OPTIONS} />);
    const combobox = screen.getByRole("combobox");
    combobox.focus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledWith("a");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("ArrowDownを2回押してからEnterすると2番目が選ばれる", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Select value="" onChange={onChange} options={OPTIONS} />);
    screen.getByRole("combobox").focus();
    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    expect(onChange).toHaveBeenCalledWith("b");
  });

  it("Escapeでリストを閉じる（選択は変えない）", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Select value="" onChange={onChange} options={OPTIONS} />);
    screen.getByRole("combobox").focus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("文字入力でその文字から始まる選択肢へジャンプする（先頭一致）", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Select value="" onChange={onChange} options={OPTIONS} />);
    screen.getByRole("combobox").focus();
    await user.keyboard("{ArrowDown}"); // open
    await user.keyboard("c");
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledWith("c");
  });

  it("Homeで先頭、Endで末尾の選択肢へ移動する", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Select value="" onChange={onChange} options={OPTIONS} />);
    screen.getByRole("combobox").focus();
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{End}{Enter}");
    expect(onChange).toHaveBeenCalledWith("c");
  });
});

describe("Select（Modal等の外側document Escapeリスナーとの共存）", () => {
  it("Escapeはリストだけを閉じ、外側のbubbleフェーズEscapeリスナー（Modal.tsx相当）へは伝播させない", async () => {
    const outerEscapeHandler = vi.fn();
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") outerEscapeHandler();
    });
    const user = userEvent.setup();
    render(<Select value="" onChange={vi.fn()} options={OPTIONS} />);
    screen.getByRole("combobox").focus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    // Modal.tsxの実装（document上のbubbleフェーズEscapeリスナーがマウント時から
    // 登録済み）を模した外側ハンドラは、Selectのcaptureフェーズでの
    // stopPropagation()により呼ばれないはず。
    expect(outerEscapeHandler).not.toHaveBeenCalled();
  });
});

describe("Select（アクセシビリティ属性）", () => {
  it("開いている間aria-expandedとaria-activedescendantを持つ", async () => {
    const user = userEvent.setup();
    render(<Select value="b" onChange={vi.fn()} options={OPTIONS} />);
    const combobox = screen.getByRole("combobox");
    expect(combobox).toHaveAttribute("aria-expanded", "false");
    await user.click(combobox);
    expect(combobox).toHaveAttribute("aria-expanded", "true");
    expect(combobox).toHaveAttribute("aria-activedescendant");
  });

  it("labelを渡すとaria-labelに反映される", () => {
    render(<Select value="" onChange={vi.fn()} options={OPTIONS} label="担当者" />);
    expect(screen.getByRole("combobox", { name: "担当者" })).toBeInTheDocument();
  });
});
