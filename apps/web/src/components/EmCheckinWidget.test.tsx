import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { EmCheckinForm, EmCheckinWidget, useEmCheckinController } from "./EmCheckinWidget";

// web/src/components/EmCheckinWidget.test.tsx（Next.js版）からの移植（フェーズ3.5
// evening-reviewバッチ）。useEmCheckinsがTanStack Query化された（フェーズ3.2の方針）ため
// QueryClientProviderで包む点、GETレスポンスのモックに`ok: true`を明示する点
// （queries.tsのfetchJsonは`res.ok`を見るため。旧usePollingは見ていなかった）以外は
// 検証内容を変更していない。
function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function CheckinFormWithController({ onSubmitted }: { onSubmitted: () => void }) {
  const controller = useEmCheckinController(onSubmitted);
  return <EmCheckinForm controller={controller} />;
}

describe("EmCheckinWidget", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        return {
          ok: true,
          json: async () => ({
            checkin: { id: "new", mood: 3, energy: 3, stress: 3, headroom: 3, note: "", createdAt: Date.now() },
          }),
        };
      }
      return { ok: true, json: async () => ({ checkins: [] }) };
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("記録が無ければ「まだ記録がありません」と表示する", async () => {
    render(<EmCheckinWidget />, { wrapper: createWrapper() });
    expect(screen.getByText("読み込み中…")).toBeInTheDocument();
    expect(await screen.findByText("まだ記録がありません。")).toBeInTheDocument();
  });

  it("記録するボタンでPOSTし、一覧に反映する", async () => {
    const user = userEvent.setup();
    render(<EmCheckinWidget />, { wrapper: createWrapper() });
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: "記録する" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/em-self/checkins",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    const postCall = fetchMock.mock.calls.find((c) => c[1]?.method === "POST");
    expect(JSON.parse(String(postCall![1]?.body))).toEqual(
      expect.objectContaining({ mood: 3, energy: 3, stress: 3, headroom: 3 }),
    );
    expect(await screen.findByRole("table")).toBeInTheDocument();
  });

  it("スライダーで選択し、履歴は定性ラベルで出す", async () => {
    fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        return {
          ok: true,
          json: async () => ({
            checkin: {
              id: "new",
              mood: 4,
              energy: 5,
              stress: 2,
              headroom: 4,
              note: "メモ",
              createdAt: Date.now(),
            },
          }),
        };
      }
      return { ok: true, json: async () => ({ checkins: [] }) };
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<EmCheckinWidget />, { wrapper: createWrapper() });
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "1" })).not.toBeInTheDocument();
    const moodSlider = screen.getByRole("slider", { name: /気分/ });
    await user.click(moodSlider);
    moodSlider.focus();
    await user.keyboard("{ArrowRight}");
    await user.click(screen.getByRole("button", { name: "記録する" }));
    expect(await screen.findByRole("table")).toBeInTheDocument();
    expect(screen.getAllByText("やや高").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("高")).toBeInTheDocument();
  });

  it("日付を変えてPOSTできる", async () => {
    const user = userEvent.setup();
    render(<EmCheckinWidget />, { wrapper: createWrapper() });
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: "📅 前日分などを入れる（日付を変える）" }));
    const dateInput = screen.getByLabelText("対象日");
    await user.clear(dateInput);
    await user.type(dateInput, "2026-01-15");
    await user.click(screen.getByRole("button", { name: "記録する" }));
    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find((c) => c[1]?.method === "POST");
      expect(postCall).toBeTruthy();
      expect(JSON.parse(String(postCall![1]?.body))).toEqual(
        expect.objectContaining({ createdAtDate: "2026-01-15" }),
      );
    });
  });

  it("useEmCheckinControllerにonSubmittedを渡すと、記録成功時に呼ばれる", async () => {
    const user = userEvent.setup();
    const onSubmitted = vi.fn();
    render(<CheckinFormWithController onSubmitted={onSubmitted} />, { wrapper: createWrapper() });
    await user.click(screen.getByRole("button", { name: "記録する" }));
    await waitFor(() => expect(onSubmitted).toHaveBeenCalledWith(expect.objectContaining({ id: "new" })));
  });

  it("失敗時はエラーメッセージを表示する", async () => {
    fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        return { ok: false, json: async () => ({ error: "記録に失敗しました" }) };
      }
      return { ok: true, json: async () => ({ checkins: [] }) };
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<EmCheckinWidget />, { wrapper: createWrapper() });
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: "記録する" }));
    expect(await screen.findByText("記録に失敗しました")).toBeInTheDocument();
  });
});
