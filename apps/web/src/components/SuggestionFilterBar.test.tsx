import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DEFAULT_SUGGESTION_STATUS_FILTER, type SuggestionFilterState } from "./suggestionFilter";
import { SuggestionFilterBar } from "./SuggestionFilterBar";

function state(overrides: Partial<SuggestionFilterState> = {}): SuggestionFilterState {
  return {
    query: "",
    sort: "due",
    statusFilter: new Set(DEFAULT_SUGGESTION_STATUS_FILTER),
    priorityFilter: new Set(),
    showDone: false,
    showArchived: false,
    ...overrides,
  };
}

describe("SuggestionFilterBar", () => {
  it("適用中の絞り込みをチップで見せる", () => {
    render(
      <SuggestionFilterBar
        value={state()}
        onChange={() => {}}
        onClearFilters={() => {}}
        doneCount={2}
        archivedCount={1}
      />,
    );
    expect(screen.getByRole("button", { name: /確認状態: 未確認・確認中・確認保留を解除/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /確認済みを隠すを解除/ })).toBeInTheDocument();
  });

  it("絞り込みポップオーバーで確認済み表示を適用できる", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <SuggestionFilterBar
        value={state()}
        onChange={onChange}
        onClearFilters={() => {}}
        doneCount={2}
        archivedCount={0}
      />,
    );
    await user.click(screen.getByRole("button", { name: "絞り込み" }));
    const dialog = screen.getByRole("dialog", { name: "絞り込み" });
    await user.click(within(dialog).getByLabelText(/確認済み（もう追わない）も表示する/));
    await user.click(within(dialog).getByRole("button", { name: /適用する/ }));
    expect(onChange).toHaveBeenCalledWith({
      statusFilter: new Set(DEFAULT_SUGGESTION_STATUS_FILTER),
      priorityFilter: new Set(),
      showDone: true,
      showArchived: false,
    });
  });
});
