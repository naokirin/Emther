import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { VitalsSettingsGroup } from "./VitalsSettingsGroup";
import { makeRules } from "./test-fixtures";

// 「判定に使う参照期間（日）」はTeam Vital / 1on1 Coverageの両セクションに同名ラベルが
// 存在するため getAllByLabelText で取得する（先頭=Team Vital側）。
describe("VitalsSettingsGroup", () => {
  it("値を変更するとonChangeへ差分だけ渡す", () => {
    const onChange = vi.fn();
    render(<VitalsSettingsGroup draft={makeRules()} onChange={onChange} />);
    const [input] = screen.getAllByLabelText("判定に使う参照期間（日）");
    fireEvent.change(input, { target: { value: "21" } });
    expect(onChange).toHaveBeenLastCalledWith({ teamWindowDays: 21 });
  });
});
