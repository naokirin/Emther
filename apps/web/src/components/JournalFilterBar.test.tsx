import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { JournalFilterBar, type JournalFilterState } from "./JournalFilterBar";

const EMPTY: JournalFilterState = {
  query: "",
  periodDays: "all",
  personFilter: "",
  tagFilter: "",
  urgencyFilter: "",
  sentimentFilter: "",
  excludeResolved: false,
  includeArchived: false,
  quarantinedOnly: false,
  includeSensitive: false,
};

describe("JournalFilterBar", () => {
  it("Selectの選択肢をクリックしても絞り込みパネルは開いたまま、適用で反映される", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <JournalFilterBar
        value={EMPTY}
        onChange={onChange}
        onClear={vi.fn()}
        periodOptions={[
          { value: "all", label: "すべての期間" },
          { value: "30", label: "直近30日" },
        ]}
        urgencyOptions={[{ value: "", label: "すべて" }]}
        sentimentOptions={[{ value: "", label: "すべて" }]}
        people={[]}
        tags={[]}
      />,
    );

    await user.click(screen.getByRole("button", { name: /絞り込み/ }));
    expect(screen.getByRole("dialog", { name: "絞り込み" })).toBeInTheDocument();

    const periodCombobox = screen.getAllByRole("combobox")[0]!;
    await user.click(periodCombobox);
    await user.click(screen.getByRole("option", { name: "直近30日" }));

    expect(screen.getByRole("dialog", { name: "絞り込み" })).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "適用する" }));
    expect(onChange).toHaveBeenCalledWith("periodDays", "30");
    expect(screen.queryByRole("dialog", { name: "絞り込み" })).not.toBeInTheDocument();
  });
});
