import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AgentRunSettingsGroup } from "./AgentRunSettingsGroup";
import { makeRules } from "./test-fixtures";

// web/src/components/settings/AgentRunSettingsGroup.tsx（Next.js版）には専用テストが
// 元々無かったため新規に追加する（フェーズ3.5 tier2 settingsバッチ）。
describe("AgentRunSettingsGroup", () => {
  it("チェックボックスの切り替えでonChangeが呼ばれる", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<AgentRunSettingsGroup draft={makeRules({ teamParallelKickoffEnabled: true })} onChange={onChange} />);
    await user.click(screen.getByRole("checkbox", { name: /提案に紐づくLead起動時/ }));
    expect(onChange).toHaveBeenCalledWith({ teamParallelKickoffEnabled: false });
  });
});
