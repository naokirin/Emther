import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import {
  SUGGESTION_THEME_ALL,
  SUGGESTION_THEME_UNLINKED,
  SuggestionThemeSwitcher,
} from "./SuggestionThemeSwitcher";
import type { OrgTheme } from "@emther/core/types";

function theme(overrides: Partial<OrgTheme> & Pick<OrgTheme, "id" | "title">): OrgTheme {
  return {
    summary: "要約テキスト",
    rationale: "",
    facts: [],
    evidenceJournalIds: [],
    evidenceSuggestionIds: [],
    status: "adopted",
    createdAt: 1,
    updatedAt: 1,
    adoptedAt: 1,
    ...overrides,
  };
}

describe("SuggestionThemeSwitcher", () => {
  it("閉じた状態で長文テーマ名を全文表示する", () => {
    render(
      <MemoryRouter>
        <SuggestionThemeSwitcher
          value="theme-1"
          onChange={() => {}}
          themes={[
            theme({
              id: "theme-1",
              title: "優先度の高いセキュリティリスクの排除とリスク運用実現",
              summary: "重大インシデントにつながる穴を先に潰す",
            }),
          ]}
          counts={{ [SUGGESTION_THEME_ALL]: 5, "theme-1": 4, [SUGGESTION_THEME_UNLINKED]: 1 }}
          statusSummary="未確認 2 · 確認中 1 · 期日超過 1"
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole("combobox", { name: "いま向き合うテーマ" })).toHaveTextContent(
      "優先度の高いセキュリティリスクの排除とリスク運用実現",
    );
    expect(screen.getByText("重大インシデントにつながる穴を先に潰す")).toBeInTheDocument();
    expect(screen.getByText("未確認 2 · 確認中 1 · 期日超過 1")).toBeInTheDocument();
  });

  it("開いたメニューで要約と件数を示し、選択できる", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <SuggestionThemeSwitcher
          value={SUGGESTION_THEME_ALL}
          onChange={onChange}
          themes={[theme({ id: "theme-1", title: "オンボーディング90日の立ち上がりを安定させる" })]}
          counts={{ [SUGGESTION_THEME_ALL]: 12, "theme-1": 3, [SUGGESTION_THEME_UNLINKED]: 1 }}
          statusSummary="未確認 0 · 確認中 0 · 期日超過 0"
        />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole("combobox", { name: "いま向き合うテーマ" }));
    expect(screen.getByRole("option", { name: /すべて/ })).toHaveTextContent("12");
    expect(screen.getByRole("option", { name: /オンボーディング/ })).toHaveTextContent("3");
    expect(screen.getByRole("option", { name: /未接続/ })).toHaveTextContent("1");
    await user.click(screen.getByRole("option", { name: /オンボーディング/ }));
    expect(onChange).toHaveBeenCalledWith("theme-1");
  });
});
