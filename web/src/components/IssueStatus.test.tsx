// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { IssueStatusBadge } from "./IssueStatus";

describe("IssueStatusBadge", () => {
  it("ステータスに応じたアイコン・ラベルを表示する", () => {
    render(<IssueStatusBadge status="blocked" />);
    expect(screen.getByText(/ブロッカーあり/)).toBeInTheDocument();
  });
});
