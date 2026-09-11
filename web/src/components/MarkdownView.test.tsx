// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MarkdownView } from "./MarkdownView";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

describe("MarkdownView", () => {
  it("太字・見出し・箇条書きをレンダリングする", () => {
    render(<MarkdownView text={"# 見出し\n\n**太字**の説明\n\n- 項目1\n- 項目2"} />);
    expect(screen.getByRole("heading", { level: 1, name: "見出し" })).toBeInTheDocument();
    expect(screen.getByText("太字").tagName).toBe("STRONG");
    expect(screen.getByText("項目1")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("単一の改行も<br>として扱う（remark-breaks、textarea入力時の見た目を保つ）", () => {
    const { container } = render(<MarkdownView text={"1行目\n2行目"} />);
    expect(container.querySelector("br")).toBeInTheDocument();
  });

  it("リンクは新規タブで開く設定にする", () => {
    render(<MarkdownView text="[リンク](https://example.com)" />);
    const link = screen.getByRole("link", { name: "リンク" });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noreferrer noopener");
  });

  it("短い ID 断片を /go への内部リンクにする（新規タブにしない）", () => {
    render(<MarkdownView text="関連 Issue a1b2c3d4 を確認" />);
    const link = screen.getByRole("link", { name: "a1b2c3d4" });
    expect(link).toHaveAttribute("href", "/go/a1b2c3d4");
    expect(link).not.toHaveAttribute("target");
  });

  it("プレーンテキストもそのまま表示する（Markdown記法が無くても壊れない）", () => {
    render(<MarkdownView text="ただの一文です" />);
    expect(screen.getByText("ただの一文です")).toBeInTheDocument();
  });
});
