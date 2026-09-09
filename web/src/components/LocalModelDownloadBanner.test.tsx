// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { LocalModelDownloadBanner } from "./LocalModelDownloadBanner";

describe("LocalModelDownloadBanner", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        json: async () => ({
          overall: "downloading",
          models: [
            {
              key: "chat",
              label: "ジャーナル抽出",
              modelId: "mock/chat",
              phase: "downloading",
              progress: 42,
              loadedBytes: 42_000_000,
              totalBytes: 100_000_000,
              cached: false,
              error: null,
            },
            {
              key: "embedding",
              label: "意味検索（埋め込み）",
              modelId: "mock/embed",
              phase: "idle",
              progress: 0,
              loadedBytes: null,
              totalBytes: null,
              cached: null,
              error: null,
            },
          ],
        }),
      })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("ダウンロード中は進捗バナーを表示する", async () => {
    render(<LocalModelDownloadBanner />);
    expect(await screen.findByText("ローカルモデルをダウンロードしています…")).toBeInTheDocument();
    expect(screen.getByText(/ジャーナル抽出/)).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "42");
  });

  it("ready のときは何も表示しない", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        json: async () => ({ overall: "ready", models: [] }),
      })),
    );
    const { container } = render(<LocalModelDownloadBanner />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("error 時は再試行ボタンで POST する", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        json: async () => ({
          overall: "error",
          models: [
            {
              key: "chat",
              label: "ジャーナル抽出",
              modelId: "mock/chat",
              phase: "error",
              progress: 0,
              loadedBytes: null,
              totalBytes: null,
              cached: false,
              error: "boom",
            },
          ],
        }),
      })
      .mockResolvedValue({
        json: async () => ({ overall: "ready", models: [] }),
      });
    vi.stubGlobal("fetch", fetchMock);

    render(<LocalModelDownloadBanner />);
    expect(await screen.findByText("ローカルモデルの取得に失敗しました")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "再試行" }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/models/status", { method: "POST" });
    });
  });
});
