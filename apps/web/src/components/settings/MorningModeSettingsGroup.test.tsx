import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MorningModeSettingsGroup } from "./MorningModeSettingsGroup";
import { makeRules } from "./test-fixtures";

describe("MorningModeSettingsGroup", () => {
  it("上限件数を変更するとonChangeへ渡す", () => {
    const onChange = vi.fn();
    render(<MorningModeSettingsGroup draft={makeRules()} onChange={onChange} />);
    const input = screen.getByLabelText("判断待ち（decision）レーンの上限件数");
    fireEvent.change(input, { target: { value: "5" } });
    expect(onChange).toHaveBeenLastCalledWith({ decisionQueueLimit: 5 });
  });
});
