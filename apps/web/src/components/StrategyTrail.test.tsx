import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { StrategyTrail } from "./StrategyTrail";
import type { StrategyTrailNode } from "@emther/core/strategy-trail";

// web/src/components/StrategyTrail.test.tsx（Next.js版）からの移植（フェーズ3.5 tier4
// journalバッチ）。`next/link`→`react-router`の`Link`に伴いMemoryRouterで包む以外は
// 検証内容を変更していない。
const nodes: StrategyTrailNode[] = [
  { kind: "objective", id: "obj-1", label: "エンジニア満足度向上" },
  { kind: "keyResult", id: "kr-1", label: "1on1カバレッジ90%", objectiveId: "obj-1" },
  { kind: "issue", id: "issue-1", label: "Bチーム1on1不足" },
  { kind: "journal", id: "journal-1", label: "このJournal" },
];

function renderTrail(currentKind: StrategyTrailNode["kind"], trailNodes: StrategyTrailNode[] = nodes) {
  return render(
    <MemoryRouter>
      <StrategyTrail nodes={trailNodes} currentKind={currentKind} />
    </MemoryRouter>,
  );
}

describe("StrategyTrail", () => {
  it("nodesが空なら何も描画しない", () => {
    const { container } = renderTrail("issue", []);
    // MemoryRouterがラップするため直下は空だが、StrategyTrail自体は何も出力しない。
    expect(container.textContent).toBe("");
  });

  it("現在地ノードはリンクにせず、他はリンクにする", () => {
    renderTrail("issue");

    expect(screen.getByText(/Bチーム1on1不足/)).not.toHaveAttribute("href");
    expect(screen.getByRole("link", { name: /エンジニア満足度向上/ })).toHaveAttribute(
      "href",
      "/org/thread?objective=obj-1",
    );
    expect(screen.getByRole("link", { name: /1on1カバレッジ90%/ })).toHaveAttribute(
      "href",
      "/org/thread?objective=obj-1",
    );
    expect(screen.getByRole("link", { name: /このJournal/ })).toHaveAttribute(
      "href",
      "/journal?focus=journal-1",
    );
  });

  it("currentKindをjournalにするとJournalノードが現在地になる", () => {
    renderTrail("journal");

    expect(screen.getByText(/このJournal/)).not.toHaveAttribute("href");
    expect(screen.getByRole("link", { name: /Bチーム1on1不足/ })).toHaveAttribute("href", "/suggestions/issue-1");
  });
});
