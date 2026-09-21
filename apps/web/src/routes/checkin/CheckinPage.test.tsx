import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { CheckinPage } from "./CheckinPage";

vi.mock("react-chartjs-2", () => ({
  Line: () => <div data-testid="line-chart" />,
  Bar: () => <div data-testid="bar-chart" />,
}));

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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CheckinPage", () => {
  it("タイトルと入力・推移・履歴のセクションを出す", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ checkins: [] }) })),
    );
    render(<CheckinPage />, { wrapper: createWrapper() });
    expect(screen.getByRole("heading", { name: "自己チェックイン" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "今日のコンディション" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "チェックインの推移" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "記録履歴" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("まだ記録がありません。")).toBeInTheDocument());
  });
});
