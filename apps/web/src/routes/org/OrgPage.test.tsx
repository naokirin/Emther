import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { OrgPage } from "./OrgPage";

// web/src/app/org/page.tsx（Next.js版）には専用テストが元々無かったため新規に追加する
// （フェーズ3.5 tier3、orgバッチ）。左ツリー項目（Strategy/Standing Background/Policy/
// Goal/Themes/Glossary）への切り替えと、代表的な1つの保存フロー（Strategy）を検証する
// （各パネル個別の詳細ロジックはPersonHeader等より複雑で数が多いため、この統合テストで
// 「移植したコードが正しく繋がっているか」を確認する範囲に留める）。
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

  it("初期表示では左ツリーからの選択を促すメッセージを表示する", () => {
    render(<OrgPage />, { wrapper: createWrapper() });
    expect(screen.getByText(/左のツリーからMVV・Goal/)).toBeInTheDocument();
  });

  it("MVVを選ぶと値を読み込み、編集して保存できる", async () => {
    const user = userEvent.setup();
    render(<OrgPage />, { wrapper: createWrapper() });

    await user.click(screen.getByText("📄 MVV"));
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

    await user.click(screen.getByText(/📄 Goal/));
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

    await user.type(screen.getByLabelText(/Goal（到達したい状態/), "チームの自律性を高めたい");
    await user.click(screen.getByRole("button", { name: "追加" }));

    await waitFor(() =>
      expect(fetchWithCreated).toHaveBeenCalledWith("/api/org/goals", expect.objectContaining({ method: "POST" })),
    );
    expect(await screen.findByDisplayValue("チームの自律性を高めたい")).toBeInTheDocument();
  });
});
