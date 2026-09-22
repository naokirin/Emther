import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DailySituationPanel } from "./DailySituationPanel";
import type { DailySituation, SituationItem } from "../../lib/daily-situation";

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

const emptyTone = [
  { weekStart: 1, label: "3週前", positive: 0, neutral: 0, negative: 0, total: 0 },
  { weekStart: 2, label: "前々週", positive: 0, neutral: 0, negative: 0, total: 0 },
  { weekStart: 3, label: "前週", positive: 0, neutral: 0, negative: 0, total: 0 },
  { weekStart: 4, label: "今週", positive: 0, neutral: 0, negative: 0, total: 0 },
];

describe("DailySituationPanel", () => {
  it("未ロード中は読み込み中を表示する", () => {
    render(
      <DailySituationPanel situation={baseSituation()} loaded={false} weeklyTone={emptyTone} attentionChips={[]} />,
    );
    expect(screen.getByText("読み込み中…")).toBeInTheDocument();
  });

  it("材料見出しと3カラムを表示する", () => {
    render(
      <DailySituationPanel situation={baseSituation()} loaded={true} weeklyTone={emptyTone} attentionChips={[]} />,
    );
    expect(screen.getByRole("heading", { name: "材料（判断はEMがする）" })).toBeInTheDocument();
    expect(screen.getByText("昨日から変わったこと")).toBeInTheDocument();
    expect(screen.getByText("気になる兆候")).toBeInTheDocument();
    expect(screen.getByText("過去との比較")).toBeInTheDocument();
  });

  it("signalKind付きconcernsは気になる兆候として表示する", () => {
    const situation = baseSituation({
      concerns: [item({ id: "event-1", text: "要注意のチームが2つ", signalKind: "vitals" })],
    });
    render(
      <DailySituationPanel situation={situation} loaded={true} weeklyTone={emptyTone} attentionChips={[]} />,
    );
    expect(screen.getByText("要注意のチームが2つ")).toBeInTheDocument();
    expect(screen.getByText("チーム状態")).toBeInTheDocument();
  });

  it("兆候が空のとき組織レベル向けのempty文を出す", () => {
    render(
      <DailySituationPanel situation={baseSituation()} loaded={true} weeklyTone={emptyTone} attentionChips={[]} />,
    );
    expect(screen.getByText("組織レベルの気になる兆候は見当たりません")).toBeInTheDocument();
  });

  it("昨日から変わったことをクリックするとonSelectが呼ばれる", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    const situation = baseSituation({
      changes: [item({ id: "change-1", text: "新しい記録", onSelect })],
    });
    render(
      <DailySituationPanel situation={situation} loaded={true} weeklyTone={emptyTone} attentionChips={[]} />,
    );
    await user.click(screen.getByText("新しい記録"));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("注目チップを表示する", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <DailySituationPanel
        situation={baseSituation()}
        loaded={true}
        weeklyTone={emptyTone}
        attentionChips={[item({ id: "attn", text: "プラットフォーム", status: "bad", onSelect })]}
      />,
    );
    await user.click(screen.getByText("プラットフォーム"));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("4週トーンがあるときネガ読み出しを出す", () => {
    const tone = [
      { weekStart: 1, label: "3週前", positive: 1, neutral: 1, negative: 1, total: 3 },
      { weekStart: 2, label: "前々週", positive: 1, neutral: 1, negative: 2, total: 4 },
      { weekStart: 3, label: "前週", positive: 1, neutral: 1, negative: 2, total: 4 },
      { weekStart: 4, label: "今週", positive: 0, neutral: 1, negative: 5, total: 6 },
    ];
    render(
      <DailySituationPanel situation={baseSituation()} loaded={true} weeklyTone={tone} attentionChips={[]} />,
    );
    expect(screen.getByText(/ネガ 1→2→2→5/)).toBeInTheDocument();
  });
});
