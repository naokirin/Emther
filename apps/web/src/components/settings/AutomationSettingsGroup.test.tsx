import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AutomationSettingsGroup } from "./AutomationSettingsGroup";
import { makeRules } from "./test-fixtures";

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

  it("週次レビューの自動起動を有効化できる", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<AutomationSettingsGroup draft={makeRules({ autoWeeklyReportEnabled: false })} onChange={onChange} />);
    await user.click(screen.getByRole("checkbox", { name: "毎週、指定曜日・時刻以降に自動で週次レビューを起動する" }));
    expect(onChange).toHaveBeenCalledWith({ autoWeeklyReportEnabled: true });
  });

  it("月次レビューの起動日は1〜28日にクランプする", () => {
    const onChange = vi.fn();
    render(<AutomationSettingsGroup draft={makeRules({ autoMonthlyReportEnabled: true, autoMonthlyReportDay: 1 })} onChange={onChange} />);
    const dayInput = screen.getByLabelText("起動する日（1〜28日、サーバーのローカル時刻）");
    fireEvent.change(dayInput, { target: { value: "31" } });
    expect(onChange).toHaveBeenCalledWith({ autoMonthlyReportDay: 28 });
  });
});
