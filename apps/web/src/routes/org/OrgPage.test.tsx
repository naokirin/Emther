import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { OrgPage } from "./OrgPage";

function createWrapper(initialEntries: string[] = ["/org"]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={initialEntries}>{children}</MemoryRouter>
      </QueryClientProvider>
    );
  };
}

async function defaultResponder(url: string, init?: RequestInit) {
  if (url === "/api/org/strategy" && init?.method === "PATCH") {
    return { ok: true, json: async () => ({}) };
  }
  if (url === "/api/org/strategy") return { ok: true, json: async () => ({ strategy: { mission: "m", vision: "v", values: "va" } }) };
  if (url === "/api/org/background") return { ok: true, json: async () => ({ backgrounds: [] }) };
  if (url === "/api/org/goals") return { ok: true, json: async () => ({ goals: [] }) };
  if (url === "/api/org/policies") return { ok: true, json: async () => ({ policies: [] }) };
  if (url === "/api/teams") return { ok: true, json: async () => ({ teams: [] }) };
  if (url === "/api/themes") return { ok: true, json: async () => ({ themes: [] }) };
  if (url.startsWith("/api/knowledge/events")) return { ok: true, json: async () => ({ events: [] }) };
  return { ok: true, json: async () => ({}) };
}

describe("OrgPage", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(defaultResponder);
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("初期表示は概要（全体スキャン）で、未設定の補足を出す", async () => {
    render(<OrgPage />, { wrapper: createWrapper() });
    expect(screen.getByRole("heading", { name: "いまのレンズ" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "フィット" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "拡大" })).toBeInTheDocument();
    expect(await screen.findByText(/Goal がまだない/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ジャーナルで考える" })).toHaveAttribute("href", "/journal");
    expect(screen.getByRole("link", { name: "相談で考える" })).toHaveAttribute("href", "/chat");
  });

  it("フラットナビからMVVを選び、編集して保存できる", async () => {
    const user = userEvent.setup();
    render(<OrgPage />, { wrapper: createWrapper() });

    await user.click(screen.getByRole("button", { name: /MVV/ }));
    const missionInput = await screen.findByDisplayValue("m");

    await user.clear(missionInput);
    await user.type(missionInput, "新しいミッション");
    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/org/strategy", expect.objectContaining({ method: "PATCH" })),
    );
  });

  it("Goalを選び、新規Goalを追加できる", async () => {
    const user = userEvent.setup();
    render(<OrgPage />, { wrapper: createWrapper() });

    await user.click(screen.getByRole("button", { name: /^Goal/ }));
    await screen.findByText("新規追加");

    const created = { id: "g1", title: "チームの自律性を高めたい", teamId: null, note: "", status: "active" };
    let goals: (typeof created)[] = [];
    const fetchWithCreated = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/org/goals" && init?.method === "POST") {
        goals = [...goals, created];
        return { ok: true, json: async () => ({ goal: created }) };
      }
      if (url === "/api/org/goals") return { ok: true, json: async () => ({ goals }) };
      return defaultResponder(url, init);
    });
    vi.stubGlobal("fetch", fetchWithCreated);

    await user.type(screen.getByLabelText(/見出し（組織・チームの到達状態）/), "チームの自律性を高めたい");
    await user.click(screen.getByRole("button", { name: "追加" }));

    await waitFor(() =>
      expect(fetchWithCreated).toHaveBeenCalledWith("/api/org/goals", expect.objectContaining({ method: "POST" })),
    );
    expect(await screen.findByDisplayValue("チームの自律性を高めたい")).toBeInTheDocument();
  });

  it("概要でGoalを選ぶとフォーカスに入り、スキャンへ戻れる", async () => {
    const user = userEvent.setup();
    const goals = [
      {
        id: "g1",
        title: "テックリードが自律的に設計判断できる状態",
        status: "active",
        createdAt: 1,
        updatedAt: 2,
        horizon: "mid",
      },
    ];
    const themes = [
      {
        id: "t1",
        title: "権限委譲",
        summary: "TL主導へ",
        rationale: "",
        facts: [],
        evidenceJournalIds: [],
        evidenceSuggestionIds: [],
        goalIds: ["g1"],
        status: "adopted",
        createdAt: 1,
        updatedAt: 2,
      },
    ];
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === "/api/org/goals") return { ok: true, json: async () => ({ goals }) };
      if (url === "/api/themes") return { ok: true, json: async () => ({ themes }) };
      return defaultResponder(url, init);
    });

    render(<OrgPage />, { wrapper: createWrapper() });
    expect(await screen.findByText("テックリードが自律的に設計判断できる状態")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /テックリードが自律的に設計判断できる状態/ }));
    expect(screen.getByRole("heading", { name: "いまのレンズ" })).toBeInTheDocument();
    expect(screen.getByText("G1 フォーカス")).toBeInTheDocument();
    expect(screen.getByText("権限委譲")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "← スキャンへ" }));
    expect(screen.queryByText("G1 フォーカス")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "フィット" })).toBeInTheDocument();
    expect(screen.getByText("スキャン")).toBeInTheDocument();
  });
});
