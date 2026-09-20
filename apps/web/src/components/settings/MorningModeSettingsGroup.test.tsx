import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MorningModeSettingsGroup } from "./MorningModeSettingsGroup";
import { makeRules } from "./test-fixtures";

// web/src/components/settings/MorningModeSettingsGroup.tsx（Next.js版）には専用テストが
// 元々無かったため新規に追加する（フェーズ3.5 tier2 settingsバッチ）。
describe("MorningModeSettingsGroup", () => {
  it("上限件数を変更するとonChangeへ渡す", () => {
    const onChange = vi.fn();
    render(<MorningModeSettingsGroup draft={makeRules()} onChange={onChange} />);
    const input = screen.getByLabelText("判断待ち（decision）レーンの上限件数");
    fireEvent.change(input, { target: { value: "5" } });
    expect(onChange).toHaveBeenLastCalledWith({ decisionQueueLimit: 5 });
  });
});
