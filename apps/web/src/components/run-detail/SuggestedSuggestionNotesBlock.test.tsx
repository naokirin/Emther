import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { SuggestedSuggestionNotesBlock } from "./SuggestedSuggestionNotesBlock";
import type { SuggestedSuggestionNote } from "../RunDetail";

// web/src/components/run-detail/SuggestedIssueNotesBlock.tsx（Next.js版）には専用テストが
// 元々無かったため新規に追加する（フェーズ3.5 tier4 suggestionsバッチ）。チェックボックスの
// 選択状態を対象indexに正しく反映できているかを検証する。
const NOTES: SuggestedSuggestionNote[] = [
  { suggestionId: "a1b2c3d4e5f6", text: "追記内容A" },
  { suggestionId: "1a2b3c4d5e6f", text: "追記内容B" },
];

function renderBlock(overrides: Partial<React.ComponentProps<typeof SuggestedSuggestionNotesBlock>> = {}) {
  return render(
    <MemoryRouter>
      <SuggestedSuggestionNotesBlock notes={NOTES} {...overrides} />
    </MemoryRouter>,
  );
}

describe("SuggestedSuggestionNotesBlock", () => {
  it("初期状態は全件選択されており、採用は選択中indexで呼ばれる", async () => {
    const onAdopt = vi.fn();
    const user = userEvent.setup();
    renderBlock({ onAdopt });
    await user.click(screen.getByRole("button", { name: "採用して追記する" }));
    expect(onAdopt).toHaveBeenCalledWith([0, 1]);
  });

  it("チェックを外すと対象から除外される", async () => {
    const onDismiss = vi.fn();
    const user = userEvent.setup();
    renderBlock({ onDismiss });
    const checkboxes = screen.getAllByRole("checkbox");
    await user.click(checkboxes[0]);
    await user.click(screen.getByRole("button", { name: "却下する" }));
    expect(onDismiss).toHaveBeenCalledWith([1]);
  });

  it("選択が無いと各ボタンはdisabledになる", async () => {
    const user = userEvent.setup();
    renderBlock();
    const checkboxes = screen.getAllByRole("checkbox");
    await user.click(checkboxes[0]);
    await user.click(checkboxes[1]);
    expect(screen.getByRole("button", { name: "採用して追記する" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "対応済みにする" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "却下する" })).toBeDisabled();
  });

  it("対応済みにするボタンはonMarkHandledを選択中indexで呼ぶ", async () => {
    const onMarkHandled = vi.fn();
    const user = userEvent.setup();
    renderBlock({ onMarkHandled });
    await user.click(screen.getByRole("button", { name: "対応済みにする" }));
    expect(onMarkHandled).toHaveBeenCalledWith([0, 1]);
  });
});
