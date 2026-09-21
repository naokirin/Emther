import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GoalLinkSuggestPanel, SuggestionStrategyLinkSuggestPanel } from "./HierarchyLinkSuggestPanel";
import type { GoalLinkSuggestion, SuggestionStrategyLinkSuggestion } from "@emther/core/types";

// web/src/components/HierarchyLinkSuggestPanel.tsx（Next.js版）には専用テストが元々
// 無かったため新規に追加する（フェーズ3.5 tier5 dashboardバッチ）。

function goalSuggestion(overrides: Partial<GoalLinkSuggestion> = {}): GoalLinkSuggestion {
  return {
    sourceKind: "theme",
    sourceId: "theme-1",
    sourceTitle: "テーマA",
    goalIds: [],
    rationale: "理由",
    labels: { goals: [] },
    ...overrides,
  };
}

function suggestionLink(overrides: Partial<SuggestionStrategyLinkSuggestion> = {}): SuggestionStrategyLinkSuggestion {
  return {
    suggestionId: "suggestion-1",
    suggestionTitle: "提案A",
    themeId: null,
    rationale: "理由",
    labels: {},
    ...overrides,
  };
}

describe("GoalLinkSuggestPanel", () => {
  it("提案が無ければemptyTextを表示する", () => {
    render(
      <GoalLinkSuggestPanel
        suggestions={[]}
        title="テーマへのGoalリンク提案"
        emptyText="提案できるリンクがありませんでした。"
        source="heuristic"
        applyingId={null}
        onAdopt={vi.fn()}
        onDismiss={vi.fn()}
        onDismissOne={vi.fn()}
      />,
    );
    expect(screen.getByText(/提案できるリンクがありませんでした/)).toBeInTheDocument();
  });

  it("採用・スキップ・閉じるボタンでそれぞれのコールバックを呼ぶ", async () => {
    const onAdopt = vi.fn();
    const onDismiss = vi.fn();
    const onDismissOne = vi.fn();
    const user = userEvent.setup();
    const suggestion = goalSuggestion();
    render(
      <GoalLinkSuggestPanel
        suggestions={[suggestion]}
        title="テーマへのGoalリンク提案"
        emptyText="提案できるリンクがありませんでした。"
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
      <GoalLinkSuggestPanel
        suggestions={[goalSuggestion()]}
        title="テーマへのGoalリンク提案"
        emptyText="提案できるリンクがありませんでした。"
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

describe("SuggestionStrategyLinkSuggestPanel", () => {
  it("提案内容とラベルを表示する", () => {
    render(
      <SuggestionStrategyLinkSuggestPanel
        suggestions={[suggestionLink({ labels: { theme: "テーマX" } })]}
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
    expect(screen.getByText(/AI呼び出し失敗/)).toBeInTheDocument();
  });

  it("採用ボタンでonAdoptを呼ぶ", async () => {
    const onAdopt = vi.fn();
    const user = userEvent.setup();
    const suggestion = suggestionLink();
    render(
      <SuggestionStrategyLinkSuggestPanel
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
