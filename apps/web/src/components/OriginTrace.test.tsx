import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { OriginTrace } from "./OriginTrace";

describe("OriginTrace", () => {
  it("Journalと相談の本文・リンクを出す", () => {
    render(
      <MemoryRouter>
        <OriginTrace
          journals={[{ id: "j1", rawText: "現場が疲弊している", summary: "疲弊" }]}
          consult={{ id: "r1", task: "対応方針を相談したい", origin: "manual" }}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText("なぜ生まれたか")).toBeInTheDocument();
    expect(screen.getByText("📝 Journal")).toBeInTheDocument();
    expect(screen.getByText("疲弊")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Journalを開く" })).toHaveAttribute("href", "/journal?focus=j1");
    expect(screen.getByText("💬 相談")).toBeInTheDocument();
    expect(screen.getByText("対応方針を相談したい")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "相談を開く" })).toHaveAttribute("href", "/chat?runId=r1");
  });

  it("idの無いJournalはリンクを出さず本文だけ出す（旧自動分析のフォールバック）", () => {
    render(
      <MemoryRouter>
        <OriginTrace journals={[{ id: "", rawText: "引用された本文" }]} />
      </MemoryRouter>,
    );
    expect(screen.getByText("引用された本文")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Journalを開く" })).not.toBeInTheDocument();
  });

  it("生成元が無ければ何も描画しない", () => {
    const { container } = render(
      <MemoryRouter>
        <OriginTrace />
      </MemoryRouter>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
