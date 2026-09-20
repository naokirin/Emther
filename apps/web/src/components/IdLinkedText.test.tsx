import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { IdLinkedText } from "./IdLinkedText";

// web/src/components/IdLinkedText.tsx（Next.js版）には専用テストが元々無かったため
// 新規に追加する（フェーズ3.5 tier4 suggestionsバッチ）。分割ロジック自体は
// @emther/core/id-prefixのテストで検証済みのため、ここではIdFragmentLinkへの
// 委譲（リンク化されるか否か）だけを確認する。
describe("IdLinkedText", () => {
  it("ID断片を含む文はリンクとプレーンテキストに分割される", () => {
    render(
      <MemoryRouter>
        <IdLinkedText text={"提案 a1b2c3d4 を確認してください"} />
      </MemoryRouter>,
    );
    expect(screen.getByText("提案", { exact: false })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "a1b2c3d4" })).toBeInTheDocument();
  });

  it("ID断片を含まない文はリンクを生成しない", () => {
    render(
      <MemoryRouter>
        <IdLinkedText text="ただの説明文です" />
      </MemoryRouter>,
    );
    expect(screen.getByText("ただの説明文です")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
