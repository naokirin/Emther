import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "@/router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { SuggestionPeekRoot } from "./SuggestionPeekRoot";
import { useSuggestionPeek } from "./useSuggestionPeek";

function OpenButton() {
  const peek = useSuggestionPeek();
  return (
    <button type="button" onClick={() => peek.open("suggestion-1")}>
      開く
    </button>
  );
}

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>{children}</MemoryRouter>
      </QueryClientProvider>
    );
  };
}

beforeEach(() => {
  // SuggestionDetailContentは提案が見つからなければ「提案が見つかりません。」を表示するだけの
  // ため、実データの整形までは検証しない（詳細な描画内容はSuggestionDetailContent.test.tsx参照）。
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({}) })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SuggestionPeekRoot", () => {
  it("既定ではピークパネルを表示しない", () => {
    render(
      <SuggestionPeekRoot>
        <OpenButton />
      </SuggestionPeekRoot>,
      { wrapper: createWrapper() },
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("配下のuseSuggestionPeek().open()でピークパネルが開く", async () => {
    const user = userEvent.setup();
    render(
      <SuggestionPeekRoot>
        <OpenButton />
      </SuggestionPeekRoot>,
      { wrapper: createWrapper() },
    );
    await user.click(screen.getByRole("button", { name: "開く" }));
    const dialog = await screen.findByRole("dialog", { name: "提案の詳細" });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "詳細画面で開く" })).toHaveAttribute("href", "/suggestions/suggestion-1");
    expect(await screen.findByText("提案が見つかりません。")).toBeInTheDocument();
  });

  it("URLに?suggestion=が既にあれば初期表示から開いた状態になる", async () => {
    render(
      <SuggestionPeekRoot>
        <div>page</div>
      </SuggestionPeekRoot>,
      {
        wrapper: ({ children }) => {
          const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
          return (
            <QueryClientProvider client={queryClient}>
              <MemoryRouter initialEntries={["/?suggestion=suggestion-2"]}>{children}</MemoryRouter>
            </QueryClientProvider>
          );
        },
      },
    );
    expect(await screen.findByRole("dialog", { name: "提案の詳細" })).toBeInTheDocument();
  });

  it("閉じるボタンでパネルが閉じる", async () => {
    const user = userEvent.setup();
    render(
      <SuggestionPeekRoot>
        <div>page</div>
      </SuggestionPeekRoot>,
      {
        wrapper: ({ children }) => {
          const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
          return (
            <QueryClientProvider client={queryClient}>
              <MemoryRouter initialEntries={["/?suggestion=suggestion-3"]}>{children}</MemoryRouter>
            </QueryClientProvider>
          );
        },
      },
    );
    await screen.findByRole("dialog", { name: "提案の詳細" });
    await user.click(screen.getByRole("button", { name: "閉じる" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
