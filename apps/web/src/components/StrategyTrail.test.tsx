import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "@/router";
import { StrategyTrail } from "./StrategyTrail";
import type { StrategyTrailNode } from "@emther/core/strategy-trail";

// MemoryRouter で Link を検証する
const nodes: StrategyTrailNode[] = [
  { kind: "suggestion", id: "suggestion-1", label: "Bチーム1on1不足" },
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
    const { container } = renderTrail("suggestion", []);
    // MemoryRouterがラップするため直下は空だが、StrategyTrail自体は何も出力しない。
    expect(container.textContent).toBe("");
  });

  it("現在地ノードはリンクにせず、他はリンクにする", () => {
    renderTrail("suggestion");

    expect(screen.getByText(/Bチーム1on1不足/)).not.toHaveAttribute("href");
    expect(screen.getByRole("link", { name: /このJournal/ })).toHaveAttribute("href", "/journal?focus=journal-1");
  });

  it("currentKindをjournalにするとJournalノードが現在地になる", () => {
    renderTrail("journal");

    expect(screen.getByText(/このJournal/)).not.toHaveAttribute("href");
    expect(screen.getByRole("link", { name: /Bチーム1on1不足/ })).toHaveAttribute("href", "/suggestions/suggestion-1");
  });
});
