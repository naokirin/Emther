// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PersonScoreBadge } from "./PersonScoreBadge";

describe("PersonScoreBadge", () => {
  it("件数不足（合計2未満）のときは⚪️（評価不能）アイコンを表示する", () => {
    render(<PersonScoreBadge trend={{ positive: 1, negative: 0, neutral: 0 }} factCount={1} />);
    expect(screen.getByText("⚪️")).toBeInTheDocument();
  });

  it("ポジティブ優勢のときは🟢（安定）アイコンを表示する", () => {
    render(<PersonScoreBadge trend={{ positive: 3, negative: 1, neutral: 0 }} factCount={4} />);
    expect(screen.getByText("🟢")).toBeInTheDocument();
  });

  it("ネガティブ優勢のときは🔴とbadの見た目クラスになる", () => {
    render(<PersonScoreBadge trend={{ positive: 0, negative: 3, neutral: 0 }} factCount={3} />);
    const icon = screen.getByText("🔴");
    expect(icon.className).toContain("personScoreBad");
  });

  it("titleに「気にかけるべき度合い」のラベル・Journal件数・傾向の内訳を持つ", () => {
    render(<PersonScoreBadge trend={{ positive: 2, negative: 1, neutral: 0 }} factCount={3} />);
    expect(screen.getByText("🟢")).toHaveAttribute("title", "安定（Journal 3件、🙂2 🙁1）");
  });

  it("拮抗しているときは🟡（やや注意）を表示する", () => {
    render(<PersonScoreBadge trend={{ positive: 1, negative: 1, neutral: 0 }} factCount={2} />);
    expect(screen.getByText("🟡")).toBeInTheDocument();
  });
});
