import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { RootLayout } from "./RootLayout";
import { HelpPage } from "./help/HelpPage";

// LocalModelDownloadBannerが
// /api/models/status をポーリングするため fetch をモックする
afterEach(() => {
  vi.unstubAllGlobals();
});

function renderApp(initialPath: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ json: () => Promise.resolve({ overall: "idle", models: [] }) }),
  );
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: <RootLayout />,
        children: [
          { index: true, element: <div>ダッシュボード（プレースホルダー）</div> },
          { path: "help", element: <HelpPage /> },
        ],
      },
    ],
    { initialEntries: [initialPath] },
  );
  return render(<RouterProvider router={router} />);
}

describe("RootLayout", () => {
  it("グローバルナビ・スキップリンク・子ルートの内容を表示する", () => {
    renderApp("/");
    expect(screen.getByRole("link", { name: "本文へスキップ" })).toHaveAttribute("href", "#main-content");
    expect(screen.getByRole("heading", { name: "Emther" })).toBeInTheDocument();
    expect(screen.getByRole("navigation")).toBeInTheDocument();
    expect(screen.getByText("ダッシュボード（プレースホルダー）")).toBeInTheDocument();
  });

  it("子ルート（/help）に切り替わってもナビとヘッダーは維持される", () => {
    renderApp("/help");
    expect(screen.getByRole("heading", { name: "Emther" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "ヘルプ" })).toBeInTheDocument();
  });
});
