// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PersonScoreBadge } from "./PersonScoreBadge";

describe("PersonScoreBadge", () => {
  it("件数不足（合計2未満）のときは数字ではなく?を表示する", () => {
    render(<PersonScoreBadge trend={{ positive: 1, negative: 0, neutral: 0 }} factCount={1} />);
    expect(screen.getByText("?")).toBeInTheDocument();
  });

  it("十分な件数があればfactCountを数字で表示する", () => {
    render(<PersonScoreBadge trend={{ positive: 3, negative: 1, neutral: 0 }} factCount={4} />);
    expect(screen.getByText("4")).toBeInTheDocument();
  });

  it("ネガティブ優勢のときはbadの見た目クラスになる", () => {
    render(<PersonScoreBadge trend={{ positive: 0, negative: 3, neutral: 0 }} factCount={3} />);
    expect(screen.getByText("3").className).toContain("personScoreBad");
  });

  it("titleにJournal件数・傾向の内訳を持つ", () => {
    render(<PersonScoreBadge trend={{ positive: 2, negative: 1, neutral: 0 }} factCount={3} />);
    expect(screen.getByText("3")).toHaveAttribute("title", "Journal 3件（🙂2 🙁1）");
  });
});
