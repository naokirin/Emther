import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ReflectionNoteForm } from "./ReflectionNoteForm";
import { useReflectionNoteController } from "./useReflectionNoteController";

// web/src/components/growth/ReflectionNoteForm.test.tsx（Next.js版）からの移植
// （フェーズ3.5 evening-reviewバッチ）。EmCheckinWidget.test.tsxと同じ理由でQueryClientProvider
// で包み、GETレスポンスに`ok: true`を明示した以外は検証内容を変更していない。
function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function Wrapper({ onCreated }: { onCreated?: () => void }) {
  const controller = useReflectionNoteController(onCreated);
  return <ReflectionNoteForm controller={controller} />;
}

describe("ReflectionNoteForm", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        return {
          ok: true,
          json: async () => ({ note: { id: "new", type: "keep", text: "テスト", createdAt: Date.now() } }),
        };
      }
      return { ok: true, json: async () => ({ notes: [] }) };
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("種類を選び、記録するとPOSTしてonCreatedが呼ばれる", async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    render(<Wrapper onCreated={onCreated} />, { wrapper: createWrapper() });

    await user.click(screen.getByRole("button", { name: /Problem/ }));
    await user.type(screen.getByPlaceholderText(/割り込み対応/), "テスト");
    await user.click(screen.getByRole("button", { name: "記録する" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/em-self/reflection-notes",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ type: "problem", text: "テスト" }),
        }),
      ),
    );
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: "new" })));
  });

  it("失敗時はエラーメッセージを表示する", async () => {
    fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        return { ok: false, json: async () => ({ error: "記録に失敗しました" }) };
      }
      return { ok: true, json: async () => ({ notes: [] }) };
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<Wrapper />, { wrapper: createWrapper() });

    await user.type(screen.getByPlaceholderText(/割り込み対応/), "テスト");
    await user.click(screen.getByRole("button", { name: "記録する" }));
    expect(await screen.findByText("記録に失敗しました")).toBeInTheDocument();
  });
});
