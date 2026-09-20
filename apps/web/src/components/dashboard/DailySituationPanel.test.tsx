import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DailySituationPanel } from "./DailySituationPanel";
import type { DailySituation, SituationItem } from "../../lib/daily-situation";

// web/src/components/dashboard/DailySituationPanel.tsx（Next.js版）には専用テストが
// 元々無かったため新規に追加する（フェーズ3.5 tier5 dashboardバッチ）。

function item(overrides: Partial<SituationItem> & { id: string; text: string }): SituationItem {
  return { since: 0, ...overrides };
}

function baseSituation(overrides: Partial<DailySituation> = {}): DailySituation {
  return {
    changes: [],
    concerns: [],
    good: [],
    unevaluable: [],
    comparisons: [],
    worthDeciding: [],
    worthDecidingOverflow: 0,
    ...overrides,
  };
}

describe("DailySituationPanel", () => {
  it("未ロード中は読み込み中を表示する", () => {
    render(<DailySituationPanel situation={baseSituation()} loaded={false} onSeeAllDecisions={vi.fn()} />);
    expect(screen.getByText("読み込み中…")).toBeInTheDocument();
  });

  it("判断する価値がありそうなことが無ければその旨を表示する", () => {
    render(<DailySituationPanel situation={baseSituation()} loaded={true} onSeeAllDecisions={vi.fn()} />);
    expect(screen.getByText("今すぐ判断が必要な項目はありません")).toBeInTheDocument();
  });

  it("worthDecidingの先頭1件をティーザー表示し、残りは「ほかN件」ボタンで見せる", async () => {
    const onSeeAllDecisions = vi.fn();
    const user = userEvent.setup();
    const situation = baseSituation({
      worthDeciding: [item({ id: "w1", text: "判断項目1" }), item({ id: "w2", text: "判断項目2" })],
      worthDecidingOverflow: 1,
    });
    render(<DailySituationPanel situation={situation} loaded={true} onSeeAllDecisions={onSeeAllDecisions} />);
    expect(screen.getByText("判断項目1")).toBeInTheDocument();
    expect(screen.queryByText("判断項目2")).not.toBeInTheDocument();
    await user.click(screen.getByText(/ほか2件/));
    expect(onSeeAllDecisions).toHaveBeenCalledTimes(1);
  });

  it("チーム・メンバーの状態チップをentityKindで分けて表示する", () => {
    const situation = baseSituation({
      concerns: [item({ id: "c1", text: "チームA", status: "bad", entityKind: "team" })],
      good: [item({ id: "g1", text: "Bさん", status: "good", entityKind: "person" })],
    });
    render(<DailySituationPanel situation={situation} loaded={true} onSeeAllDecisions={vi.fn()} />);
    expect(screen.getByText("チームA")).toBeInTheDocument();
    expect(screen.getByText("Bさん")).toBeInTheDocument();
  });

  it("statusを持たないconcernsは気になる兆候（出来事）として表示する", () => {
    const situation = baseSituation({
      concerns: [item({ id: "event-1", text: "緊急の出来事" })],
    });
    render(<DailySituationPanel situation={situation} loaded={true} onSeeAllDecisions={vi.fn()} />);
    expect(screen.getByText("緊急の出来事")).toBeInTheDocument();
  });

  it("昨日から変わったことをクリックするとonSelectが呼ばれる", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    const situation = baseSituation({
      changes: [item({ id: "change-1", text: "新しい記録", onSelect })],
    });
    render(<DailySituationPanel situation={situation} loaded={true} onSeeAllDecisions={vi.fn()} />);
    await user.click(screen.getByText("新しい記録"));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});
