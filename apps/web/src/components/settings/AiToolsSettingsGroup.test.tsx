import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AiToolsSettingsGroup } from "./AiToolsSettingsGroup";
import { makeRules } from "./test-fixtures";

describe("AiToolsSettingsGroup", () => {
  it("除外中のCLIをチェックすると優先順位リストの末尾に追加する", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<AiToolsSettingsGroup draft={makeRules({ cliOrder: ["claude"] })} onChange={onChange} />);
    await user.click(screen.getByRole("checkbox", { name: /Cursor CLI（除外）/ }));
    expect(onChange).toHaveBeenCalledWith({ cliOrder: ["claude", "cursor"] });
  });

  it("最後の1つは除外できない（チェックボックスがdisabled）", () => {
    render(<AiToolsSettingsGroup draft={makeRules({ cliOrder: ["claude"] })} onChange={vi.fn()} />);
    expect(screen.getByRole("checkbox", { name: "Claude Code CLI" })).toBeDisabled();
  });

  it("↓ボタンで優先順位を1つ下げる", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<AiToolsSettingsGroup draft={makeRules({ cliOrder: ["claude", "cursor"] })} onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Claude Code CLIを下へ" }));
    expect(onChange).toHaveBeenCalledWith({ cliOrder: ["cursor", "claude"] });
  });

  it("学びの参考リンク検索のCursorモデルに auto を指定するとエラーを表示し保存しない", async () => {
    const onChange = vi.fn();
    render(<AiToolsSettingsGroup draft={makeRules({ cliOrder: ["claude", "cursor"] })} onChange={onChange} />);
    const input = screen.getByLabelText("学びの参考リンク検索 / Cursor CLI");
    fireEvent.change(input, { target: { value: "auto" } });
    expect(await screen.findByRole("alert")).toHaveTextContent("Autoは指定できません");
    expect(onChange).not.toHaveBeenCalledWith(expect.objectContaining({ referenceLookupCursorModel: "auto" }));
  });

  it("ローカル再ランキングのチェックを切り替える", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<AiToolsSettingsGroup draft={makeRules({ localRerankEnabled: false })} onChange={onChange} />);
    await user.click(screen.getByRole("checkbox", { name: /ローカル再ランキング/ }));
    expect(onChange).toHaveBeenCalledWith({ localRerankEnabled: true });
  });
});
