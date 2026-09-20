import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { OrgPage } from "./OrgPage";

// web/src/app/org/page.tsx（Next.js版）には専用テストが元々無かったため新規に追加する
// （フェーズ3.5 tier3、orgバッチ）。5つの左ツリー項目（Strategy/Standing Background/
// Objectives/Themes/Glossary）への切り替えと、代表的な1つの保存フロー（Strategy）を検証する
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
  if (url === "/api/org/objectives") return { ok: true, json: async () => ({ objectives: [] }) };
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
    expect(screen.getByText(/左のツリーからStrategy・Standing Background/)).toBeInTheDocument();
  });

  it("Strategyを選ぶと値を読み込み、編集して保存できる", async () => {
    const user = userEvent.setup();
    render(<OrgPage />, { wrapper: createWrapper() });

    await user.click(screen.getByText("📄 Strategy"));
    const missionInput = await screen.findByDisplayValue("m");

    await user.clear(missionInput);
    await user.type(missionInput, "新しいミッション");
    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/org/strategy", expect.objectContaining({ method: "PATCH" })),
    );
  });

  it("Objectivesを選び、新規Objectiveを追加できる", async () => {
    const user = userEvent.setup();
    render(<OrgPage />, { wrapper: createWrapper() });

    await user.click(screen.getByText(/📄 Objectives/));
    await screen.findByText("新規追加");

    // POST後のrefreshObjectives()（再GET）が作成済みObjectiveを含む必要があるため
    // （固定レスポンスだと一覧に反映されず編集フォームへ遷移しない。settings/peopleバッチで
    // 踏んだ落とし穴と同種）、状態を保持する素朴なサーバーもどきにする。
    const created = { id: "o1", title: "新しい目標", teamId: null, note: "", keyResults: [], progress: [] };
    let objectives: typeof created[] = [];
    const fetchWithCreated = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/org/objectives" && init?.method === "POST") {
        objectives = [...objectives, created];
        return { ok: true, json: async () => ({ objective: created }) };
      }
      if (url === "/api/org/objectives") return { ok: true, json: async () => ({ objectives }) };
      return defaultResponder(url, init);
    });
    vi.stubGlobal("fetch", fetchWithCreated);

    await user.type(screen.getByLabelText("Objective（目標）"), "新しい目標");
    await user.click(screen.getByRole("button", { name: "追加" }));

    await waitFor(() =>
      expect(fetchWithCreated).toHaveBeenCalledWith("/api/org/objectives", expect.objectContaining({ method: "POST" })),
    );
    // 追加成功時はbeginEditObjectiveが呼ばれ、編集フォームへ遷移する。
    expect(await screen.findByDisplayValue("新しい目標")).toBeInTheDocument();
  });

  it("?objective=<id>が既存のobjectivesに一致すれば初期表示から編集フォームを開く", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/org/objectives") {
          return {
            ok: true,
            json: async () => ({
              objectives: [{ id: "o1", title: "既存の目標", teamId: null, note: "", keyResults: [], progress: [] }],
            }),
          };
        }
        return defaultResponder(url);
      }),
    );
    render(<OrgPage />, { wrapper: createWrapper(["/org?objective=o1"]) });
    expect(await screen.findByDisplayValue("既存の目標")).toBeInTheDocument();
  });
});
