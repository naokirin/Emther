import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "@/router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { WorldModelPage } from "./WorldModelPage";

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/world-model"]}>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

const element = {
  id: "e1",
  kind: "dependency",
  title: "レビュー待ち",
  statement: "リリースがAチームのレビュー待ちで詰まる",
  teamIds: [],
  personIds: [],
  intentRefs: [],
  links: [],
  evidence: { eventIds: ["x"], journalIds: [], suggestionIds: [], themeIds: [] },
  confidence: "mid",
  status: "candidate",
  origin: "ai",
  firstObservedAt: 0,
  lastConfirmedAt: 0,
  createdAt: 0,
  updatedAt: 0,
};

describe("WorldModelPage", () => {
  const calls: string[] = [];

  beforeEach(() => {
    calls.length = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push(`${init?.method ?? "GET"} ${url}`);
        if (url.startsWith("/api/world-model") && (init?.method ?? "GET") === "GET") {
          return { ok: true, json: async () => ({ elements: [element] }) };
        }
        return { ok: true, json: async () => ({ element: { ...element, status: "adopted" } }) };
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("候補を表示し、採用操作が API に届く", async () => {
    const user = userEvent.setup();
    render(<WorldModelPage />, { wrapper });
    expect(await screen.findByText("レビュー待ち")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "採用" }));
    expect(calls).toContain("POST /api/world-model/e1/adopt");
  });
});
