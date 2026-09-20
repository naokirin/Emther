import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AutomationSettingsGroup } from "./AutomationSettingsGroup";
import { makeRules } from "./test-fixtures";

// web/src/components/settings/AutomationSettingsGroup.tsx（Next.js版）には専用テストが
// 元々無かったため新規に追加する（フェーズ3.5 tier2 settingsバッチ）。
describe("AutomationSettingsGroup", () => {
  it("Journal集約時刻を追加できる", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<AutomationSettingsGroup draft={makeRules({ autoJournalBatchEnabled: true, autoJournalBatchHours: [7] })} onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "時刻を追加" }));
    expect(onChange).toHaveBeenCalledWith({ autoJournalBatchHours: [7, 8] });
  });

  it("Journal集約時刻が1件のときは削除ボタンが無効", () => {
    render(<AutomationSettingsGroup draft={makeRules({ autoJournalBatchEnabled: true, autoJournalBatchHours: [7] })} onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "削除" })).toBeDisabled();
  });

  it("蒸留の曜日を複数選択できる（最後の1つは外せない）", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<AutomationSettingsGroup draft={makeRules({ autoDistillationEnabled: true, autoDistillationWeekdays: [1] })} onChange={onChange} />);
    await user.click(screen.getByRole("checkbox", { name: "火" }));
    expect(onChange).toHaveBeenCalledWith({ autoDistillationWeekdays: [1, 2] });
  });

  it("蒸留の曜日が1つだけのときはそのチェックを外せない", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<AutomationSettingsGroup draft={makeRules({ autoDistillationEnabled: true, autoDistillationWeekdays: [1] })} onChange={onChange} />);
    await user.click(screen.getByRole("checkbox", { name: "月" }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
