// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { StrategyTrail } from "./StrategyTrail";
import type { StrategyTrailNode } from "@/lib/strategy-trail";

const nodes: StrategyTrailNode[] = [
  { kind: "objective", id: "obj-1", label: "エンジニア満足度向上" },
  { kind: "keyResult", id: "kr-1", label: "1on1カバレッジ90%", objectiveId: "obj-1" },
  { kind: "issue", id: "issue-1", label: "Bチーム1on1不足" },
  { kind: "journal", id: "journal-1", label: "このJournal" },
];

describe("StrategyTrail", () => {
  it("nodesが空なら何も描画しない", () => {
    const { container } = render(<StrategyTrail nodes={[]} currentKind="issue" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("現在地ノードはリンクにせず、他はリンクにする", () => {
    render(<StrategyTrail nodes={nodes} currentKind="issue" />);

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
    render(<StrategyTrail nodes={nodes} currentKind="journal" />);

    expect(screen.getByText(/このJournal/)).not.toHaveAttribute("href");
    expect(screen.getByRole("link", { name: /Bチーム1on1不足/ })).toHaveAttribute("href", "/issues/issue-1");
  });
});
