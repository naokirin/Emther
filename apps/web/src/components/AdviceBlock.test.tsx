import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AdviceBlock } from "./AdviceBlock";

describe("AdviceBlock", () => {
  const structured = {
    overview: "3ステップ計画です",
    groups: [
      {
        title: "1. 最優先: 余白の確保",
        nextActions: ["関係者と話す"],
        watchOuts: ["急がない"],
      },
      {
        title: "2. 内部ケア",
        nextActions: ["連名にする"],
      },
    ],
  };

  it("summary ではグループ見出しの目次を出し、overview は出さない", async () => {
    const user = userEvent.setup();
    render(<AdviceBlock presentation="summary" fields={{ adviceStructured: structured }} />);

    expect(screen.queryByText("3ステップ計画です")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1. 最優先: 余白の確保" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "2. 内部ケア" })).toBeInTheDocument();
    expect(screen.queryByText("関係者と話す")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "全文を開く" }));
    const dialog = screen.getByRole("dialog", { name: /進め方のアドバイス/ });
    expect(within(dialog).getByText("3ステップ計画です")).toBeInTheDocument();
    expect(within(dialog).getAllByText("やること").length).toBeGreaterThan(0);
    expect(within(dialog).getByText("関係者と話す")).toBeInTheDocument();
    expect(within(dialog).getByRole("navigation", { name: "目次" })).toBeInTheDocument();
  });

  it("full ではインラインで groups も出す", () => {
    render(<AdviceBlock presentation="full" fields={{ adviceStructured: structured }} />);
    expect(screen.getAllByText("やること").length).toBeGreaterThan(0);
    expect(screen.getByText("関係者と話す")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "全文を開く" })).not.toBeInTheDocument();
  });

  it("overview のみなら目次なしで overview を出し、全文も開ける", async () => {
    const user = userEvent.setup();
    render(
      <AdviceBlock
        presentation="summary"
        fields={{ adviceStructured: { overview: "一言だけ", groups: [] } }}
      />,
    );
    expect(screen.getByText("一言だけ")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "全文を開く" }));
    expect(screen.getByRole("dialog", { name: /進め方のアドバイス/ })).toBeInTheDocument();
  });
});
