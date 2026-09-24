import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { SuggestedSuggestionUpdatesBlock } from "./SuggestedSuggestionUpdatesBlock";
import type { SuggestionUpdate } from "@emther/core/agent-runtime";
import type { Suggestion } from "@emther/core/types";

// 差分表示（前後比較）とチェックボックスの選択反映を検証する
const UPDATES: SuggestionUpdate[] = [
  { suggestionId: "a1b2c3d4e5f6", reviewStatus: "done", reason: "対応済みのため" },
];

function currentSuggestion(overrides: Partial<Suggestion> = {}): Suggestion {
  return {
    id: "a1b2c3d4e5f6",
    title: "既存の提案タイトル",
    reviewStatus: "unreviewed",
    confirmPriority: "normal",
    memos: [],
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe("SuggestedSuggestionUpdatesBlock", () => {
  it("現在値と変更後の値を差分として表示する", () => {
    render(
      <MemoryRouter>
        <SuggestedSuggestionUpdatesBlock
          updates={UPDATES}
          currentSuggestions={new Map([["a1b2c3d4e5f6", currentSuggestion()]])}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText("既存の提案タイトル")).toBeInTheDocument();
    expect(screen.getByText("🆕 未確認 → ✅ 確認済み", { exact: false })).toBeInTheDocument();
    expect(screen.getByText(/対応済みのため/)).toBeInTheDocument();
  });

  it("現在値が取得できなければ「不明」と表示する", () => {
    render(
      <MemoryRouter>
        <SuggestedSuggestionUpdatesBlock updates={UPDATES} currentSuggestions={new Map()} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/不明/)).toBeInTheDocument();
  });

  it("初期状態は全件選択されており、反映は選択中indexで呼ばれる", async () => {
    const onAdopt = vi.fn();
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <SuggestedSuggestionUpdatesBlock
          updates={UPDATES}
          currentSuggestions={new Map([["a1b2c3d4e5f6", currentSuggestion()]])}
          onAdopt={onAdopt}
        />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole("button", { name: "まとめて反映" }));
    expect(onAdopt).toHaveBeenCalledWith([0]);
  });

  it("チェックを外すと反映対象から除外され、ボタンがdisabledになる", async () => {
    const onDismiss = vi.fn();
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <SuggestedSuggestionUpdatesBlock
          updates={UPDATES}
          currentSuggestions={new Map([["a1b2c3d4e5f6", currentSuggestion()]])}
          onDismiss={onDismiss}
        />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("button", { name: "却下する" })).toBeDisabled();
  });
});
