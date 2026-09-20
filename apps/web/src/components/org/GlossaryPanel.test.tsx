import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GlossaryPanel } from "./GlossaryPanel";

describe("GlossaryPanel", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url === "/api/glossary") {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              entries: [
                {
                  id: "g-1",
                  term: "PRD",
                  reading: "ピーアールディー",
                  meaning: "Product Requirements Document。機能要件仕様書のこと。",
                  category: "ドキュメント",
                  createdAt: Date.now(),
                  updatedAt: Date.now(),
                },
              ],
            }),
          });
        }
        return Promise.resolve({ ok: true, json: async () => ({}) });
      }),
    );
  });

  it("renders glossary entries and search field", async () => {
    render(<GlossaryPanel />);

    await waitFor(() => {
      expect(screen.getByText("PRD")).toBeInTheDocument();
    });
    expect(screen.getByText(/Product Requirements Document/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText("用語や説明を検索...")).toBeInTheDocument();
  });

  it("opens create form when clicking add button and has properly styled textarea", async () => {
    const user = userEvent.setup();
    render(<GlossaryPanel />);

    await waitFor(() => {
      expect(screen.getByText("PRD")).toBeInTheDocument();
    });

    const addBtn = screen.getByText("＋ 用語を追加");
    await user.click(addBtn);

    expect(screen.getByText("📖 新しい用語を登録")).toBeInTheDocument();
    const textarea = screen.getByPlaceholderText(/Product Requirements Document。機能要件仕様書のこと。/);
    expect(textarea).toBeInTheDocument();
    expect(textarea.tagName).toBe("TEXTAREA");
    // Verify it is inside a .field container
    expect(textarea.closest("div")?.className).toMatch(/field/);
  });
});
