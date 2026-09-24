import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import styles from "../styles/page.module.css";
import { TopNav } from "../components/TopNav";
import { HelpPage } from "./help/HelpPage";

// RootLayout 本体は Outlet（本番 RouterProvider）前提のため、ここではシェル相当の
// スキップリンク＋ヘッダー＋ナビと、子ページ併置を検証する。
afterEach(() => {
  vi.unstubAllGlobals();
});

function renderShell(ui: React.ReactNode, initialPath = "/") {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ json: () => Promise.resolve({ overall: "idle", models: [] }) }),
  );
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <a href="#main-content" className={styles.skipLink}>
          本文へスキップ
        </a>
        <div className={styles.page}>
          <div className={styles.header}>
            <h1 className={styles.title}>Emther</h1>
          </div>
          <TopNav />
          <main id="main-content">{ui}</main>
        </div>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("RootLayout", () => {
  it("グローバルナビ・スキップリンク・ヘッダーを表示する", () => {
    renderShell(<div>本文プレースホルダー</div>);
    expect(screen.getByRole("link", { name: "本文へスキップ" })).toHaveAttribute("href", "#main-content");
    expect(screen.getByRole("heading", { name: "Emther" })).toBeInTheDocument();
    expect(screen.getByRole("navigation")).toBeInTheDocument();
    expect(screen.getByText("本文プレースホルダー")).toBeInTheDocument();
  });

  it("ヘルプページを並べてもナビとヘッダーは維持される", async () => {
    renderShell(<HelpPage />, "/help");
    expect(screen.getByRole("heading", { name: "Emther" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "ヘルプ" })).toBeInTheDocument();
  });
});
