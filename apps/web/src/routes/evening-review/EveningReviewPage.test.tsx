import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { EveningReviewPage } from "./EveningReviewPage";

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

// 3ステップ（journal→checkin→kpt→done）を
// 「この工程をスキップ」で最短経路で進め、doneの遷移ボタンだけ確認する（各ステップの
// 中身自体はDailyReflectionForm/EmCheckinWidget/ReflectionNoteFormの個別テストで検証済み）
function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/evening-review"]}>
          {children}
          <LocationProbe />
        </MemoryRouter>
      </QueryClientProvider>
    );
  };
}

describe("EveningReviewPage", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ entries: [], checkins: [], notes: [] }) }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("journal→checkin→kpt→doneの順にスキップで進み、完了画面から遷移できる", async () => {
    const user = userEvent.setup();
    render(<EveningReviewPage />, { wrapper: createWrapper() });

    expect(screen.getByText(/ステップ 1\/3: 1日を振り返る/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "この工程をスキップ" }));
    expect(await screen.findByText(/ステップ 2\/3: バイタルを記録する/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "この工程をスキップ" }));
    expect(await screen.findByText(/ステップ 3\/3: KPTを記録する/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "この工程をスキップ" }));

    expect(await screen.findByText("お疲れさまでした。今日の締めくくりが完了しました。")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "ダッシュボードへ戻る" }));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/"));
  });
});
