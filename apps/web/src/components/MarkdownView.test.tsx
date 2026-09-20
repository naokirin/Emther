import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { MarkdownView } from "./MarkdownView";

// web/src/components/MarkdownView.test.tsx（Next.js版）からの移植（フェーズ3.5 tier4
// journalバッチ）。内部で使う`IdFragmentLink`が`react-router`の`useNavigate`（Router context
// を要求するフック）を呼ぶため、元のnext/navigationモックの代わりにMemoryRouterで包む。
function renderMarkdown(text: string) {
  return render(
    <MemoryRouter>
      <MarkdownView text={text} />
    </MemoryRouter>,
  );
}

describe("MarkdownView", () => {
  it("太字・見出し・箇条書きをレンダリングする", () => {
    renderMarkdown("# 見出し\n\n**太字**の説明\n\n- 項目1\n- 項目2");
    expect(screen.getByRole("heading", { level: 1, name: "見出し" })).toBeInTheDocument();
    expect(screen.getByText("太字").tagName).toBe("STRONG");
    expect(screen.getByText("項目1")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("単一の改行も<br>として扱う（remark-breaks、textarea入力時の見た目を保つ）", () => {
    const { container } = renderMarkdown("1行目\n2行目");
    expect(container.querySelector("br")).toBeInTheDocument();
  });

  it("リンクは新規タブで開く設定にする", () => {
    renderMarkdown("[リンク](https://example.com)");
    const link = screen.getByRole("link", { name: "リンク" });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noreferrer noopener");
  });

  it("短い ID 断片を /go への内部リンクにする（新規タブにしない）", () => {
    renderMarkdown("関連 Issue a1b2c3d4 を確認");
    const link = screen.getByRole("link", { name: "a1b2c3d4" });
    expect(link).toHaveAttribute("href", "/go/a1b2c3d4");
    expect(link).not.toHaveAttribute("target");
  });

  it("プレーンテキストもそのまま表示する（Markdown記法が無くても壊れない）", () => {
    renderMarkdown("ただの一文です");
    expect(screen.getByText("ただの一文です")).toBeInTheDocument();
  });
});
