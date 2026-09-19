// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReflectionNoteForm, useReflectionNoteController } from "./ReflectionNoteForm";

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
      return { json: async () => ({ notes: [] }) };
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("種類を選び、記録するとPOSTしてonCreatedが呼ばれる", async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    render(<Wrapper onCreated={onCreated} />);

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
      return { json: async () => ({ notes: [] }) };
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<Wrapper />);

    await user.type(screen.getByPlaceholderText(/割り込み対応/), "テスト");
    await user.click(screen.getByRole("button", { name: "記録する" }));
    expect(await screen.findByText("記録に失敗しました")).toBeInTheDocument();
  });
});
