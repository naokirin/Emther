// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProgressBar } from "./ProgressBar";

describe("ProgressBar", () => {
  it("total:0のときは「項目なし」を表示する（0%完了と区別する）", () => {
    render(<ProgressBar done={0} total={0} />);
    expect(screen.getByText("項目なし")).toBeInTheDocument();
  });

  it("done/totalの分数ラベルを表示する", () => {
    render(<ProgressBar done={1} total={3} />);
    expect(screen.getByText("1/3")).toBeInTheDocument();
  });

  it("progressbarロールにaria値を持たせる", () => {
    render(<ProgressBar done={2} total={4} />);
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "2");
    expect(bar).toHaveAttribute("aria-valuemax", "4");
  });
});
