import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { PeoplePage } from "./PeoplePage";

// usePeopleがTanStack Query化されているため
// QueryClientProviderで包む
function createWrapper(initialEntries: string[] = ["/people"]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={initialEntries}>{children}</MemoryRouter>
      </QueryClientProvider>
    );
  };
}

const PERSON_A = {
  id: "p1",
  name: "田中さん",
  aliases: [],
  teamNames: ["Design"],
  trend: { positive: 2, negative: 0, neutral: 0 },
  factCount: 2,
  isDirectReport: true,
  isSelf: false,
  hasConcerningSuggestion: false,
  archived: false,
};

describe("PeoplePage", () => {
  beforeEach(() => {
    // 追加した人物のサイドピークがrefreshPeople()後の再GETに反映されている必要があるため
    // （固定レスポンスだと追加した人物が一覧に出ずサイドピークの対象が見つからない）
    // 状態を保持する素朴なサーバーもどきにする（
    let people = [PERSON_A];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === "/api/people" && init?.method === "POST") {
          const person = { ...PERSON_A, id: "p-new", name: "新しい人" };
          people = [...people, person];
          return { ok: true, json: async () => ({ person }) };
        }
        if (url === "/api/people") return { ok: true, json: async () => ({ people }) };
        if (url.startsWith("/api/people/")) {
          const id = url.split("/").pop();
          const person = people.find((p) => p.id === id) ?? PERSON_A;
          return {
            ok: true,
            json: async () => ({
              person: { ...person, facts: [], interpretations: [], relatedSuggestions: [] },
            }),
          };
        }
        if (url === "/api/teams") return { ok: true, json: async () => ({ teams: [] }) };
        return { ok: true, json: async () => ({}) };
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("部下として登録された人物をカードで表示する", async () => {
    render(<PeoplePage />, { wrapper: createWrapper() });
    expect(await screen.findByText("田中さん")).toBeInTheDocument();
  });

  it("人物を追加すると一覧に反映し、追加した人物のサイドピークを開く", async () => {
    const user = userEvent.setup();
    render(<PeoplePage />, { wrapper: createWrapper() });
    await screen.findByText("田中さん");

    await user.type(screen.getByLabelText("人物を追加"), "新しい人");
    await user.click(screen.getByRole("button", { name: "追加" }));

    await waitFor(() => expect(screen.getByRole("dialog", { name: "新しい人" })).toBeInTheDocument());
  });

  it("?person=<id>が既にあれば初期表示からサイドピークが開いた状態になる", async () => {
    render(<PeoplePage />, { wrapper: createWrapper(["/people?person=p1"]) });
    await waitFor(() => expect(screen.getByRole("dialog", { name: "田中さん" })).toBeInTheDocument());
  });

  it("アーカイブ済みは既定で非表示、チェックで表示できる", async () => {
    const archived = {
      ...PERSON_A,
      id: "p-arch",
      name: "退職さん",
      archived: true,
      isDirectReport: true,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/people") return { ok: true, json: async () => ({ people: [PERSON_A, archived] }) };
        if (url.startsWith("/api/people/")) {
          return {
            ok: true,
            json: async () => ({
              person: { ...PERSON_A, facts: [], interpretations: [], relatedSuggestions: [] },
            }),
          };
        }
        if (url === "/api/teams") return { ok: true, json: async () => ({ teams: [] }) };
        return { ok: true, json: async () => ({}) };
      }),
    );
    const user = userEvent.setup();
    render(<PeoplePage />, { wrapper: createWrapper() });
    expect(await screen.findByText("田中さん")).toBeInTheDocument();
    expect(screen.queryByText("退職さん")).not.toBeInTheDocument();
    await user.click(screen.getByLabelText(/アーカイブ済みも表示する/));
    expect(await screen.findByText("退職さん")).toBeInTheDocument();
  });
});
