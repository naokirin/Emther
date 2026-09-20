import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RecordDateField } from "./RecordDateField";

// web/src/components/RecordDateField.tsx（Next.js版）には専用テストが元々無かったため
// 新規に追加する（フェーズ3.5 evening-reviewバッチ）。
describe("RecordDateField", () => {
  it("open=falseのときは開くボタンのみ表示する", () => {
    render(<RecordDateField open={false} date="" onOpen={vi.fn()} onDateChange={vi.fn()} onReset={vi.fn()} />);
    expect(screen.getByRole("button", { name: "📅 前日分などを入れる（日付を変える）" })).toBeInTheDocument();
    expect(screen.queryByLabelText("対象日")).not.toBeInTheDocument();
  });

  it("開くボタンでonOpenが呼ばれる", async () => {
    const onOpen = vi.fn();
    const user = userEvent.setup();
    render(<RecordDateField open={false} date="" onOpen={onOpen} onDateChange={vi.fn()} onReset={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "📅 前日分などを入れる（日付を変える）" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("open=trueのときは日付入力と今日に戻すボタンを表示する", async () => {
    const onDateChange = vi.fn();
    const onReset = vi.fn();
    const user = userEvent.setup();
    render(<RecordDateField open date="2026-01-15" onOpen={vi.fn()} onDateChange={onDateChange} onReset={onReset} />);
    expect(screen.getByLabelText("対象日")).toHaveValue("2026-01-15");
    await user.click(screen.getByRole("button", { name: "今日に戻す" }));
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});
