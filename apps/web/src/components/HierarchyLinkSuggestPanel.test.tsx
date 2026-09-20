import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IssueStrategyLinkSuggestPanel, ThemeOkrLinkSuggestPanel } from "./HierarchyLinkSuggestPanel";
import type { IssueStrategyLinkSuggestion, ThemeOkrLinkSuggestion } from "@emther/core/types";

// web/src/components/HierarchyLinkSuggestPanel.tsx（Next.js版）には専用テストが元々
// 無かったため新規に追加する（フェーズ3.5 tier5 dashboardバッチ）。

function themeSuggestion(overrides: Partial<ThemeOkrLinkSuggestion> = {}): ThemeOkrLinkSuggestion {
  return {
    themeId: "theme-1",
    themeTitle: "テーマA",
    objectiveIds: [],
    keyResultIds: [],
    rationale: "理由",
    labels: { objectives: [], keyResults: [] },
    ...overrides,
  };
}

function issueSuggestion(overrides: Partial<IssueStrategyLinkSuggestion> = {}): IssueStrategyLinkSuggestion {
  return {
    issueId: "issue-1",
    issueTitle: "提案A",
    themeId: null,
    keyResultId: null,
    rationale: "理由",
    labels: {},
    ...overrides,
  };
}

describe("ThemeOkrLinkSuggestPanel", () => {
  it("提案が無ければその旨を表示する", () => {
    render(
      <ThemeOkrLinkSuggestPanel suggestions={[]} source="heuristic" applyingId={null} onAdopt={vi.fn()} onDismiss={vi.fn()} onDismissOne={vi.fn()} />,
    );
    expect(screen.getByText(/提案できるリンクがありませんでした/)).toBeInTheDocument();
  });

  it("採用・スキップ・閉じるボタンでそれぞれのコールバックを呼ぶ", async () => {
    const onAdopt = vi.fn();
    const onDismiss = vi.fn();
    const onDismissOne = vi.fn();
    const user = userEvent.setup();
    const suggestion = themeSuggestion();
    render(
      <ThemeOkrLinkSuggestPanel
        suggestions={[suggestion]}
        source="cloud"
        applyingId={null}
        onAdopt={onAdopt}
        onDismiss={onDismiss}
        onDismissOne={onDismissOne}
      />,
    );
    expect(screen.getByText("テーマA")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "採用してリンク" }));
    expect(onAdopt).toHaveBeenCalledWith(suggestion);
    await user.click(screen.getByRole("button", { name: "スキップ" }));
    expect(onDismissOne).toHaveBeenCalledWith("theme-1");
    await user.click(screen.getByRole("button", { name: "閉じる" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("applyingId一致時は採用ボタンが「採用中…」でdisabledになる", () => {
    render(
      <ThemeOkrLinkSuggestPanel
        suggestions={[themeSuggestion()]}
        source="cloud"
        applyingId="theme-1"
        onAdopt={vi.fn()}
        onDismiss={vi.fn()}
        onDismissOne={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "採用中…" })).toBeDisabled();
  });
});

describe("IssueStrategyLinkSuggestPanel", () => {
  it("提案内容とラベルを表示する", () => {
    render(
      <IssueStrategyLinkSuggestPanel
        suggestions={[issueSuggestion({ labels: { theme: "テーマX", keyResult: "KR-1" } })]}
        source="heuristic"
        fallbackReason="AI呼び出し失敗"
        applyingId={null}
        onAdopt={vi.fn()}
        onDismiss={vi.fn()}
        onDismissOne={vi.fn()}
      />,
    );
    expect(screen.getByText("提案A")).toBeInTheDocument();
    expect(screen.getByText(/テーマX/)).toBeInTheDocument();
    expect(screen.getByText(/KR-1/)).toBeInTheDocument();
    expect(screen.getByText(/AI呼び出し失敗/)).toBeInTheDocument();
  });

  it("採用ボタンでonAdoptを呼ぶ", async () => {
    const onAdopt = vi.fn();
    const user = userEvent.setup();
    const suggestion = issueSuggestion();
    render(
      <IssueStrategyLinkSuggestPanel
        suggestions={[suggestion]}
        source="cloud"
        applyingId={null}
        onAdopt={onAdopt}
        onDismiss={vi.fn()}
        onDismissOne={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: "採用してリンク" }));
    expect(onAdopt).toHaveBeenCalledWith(suggestion);
  });
});
