// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EmCheckinForm, EmCheckinWidget, useEmCheckinController } from "./EmCheckinWidget";

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
          json: async () => ({ checkin: { id: "new", mood: 3, energy: 3, stress: 3, note: "", createdAt: Date.now() } }),
        };
      }
      return { json: async () => ({ checkins: [] }) };
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("記録が無ければ「まだ記録がありません」と表示する", async () => {
    render(<EmCheckinWidget />);
    expect(screen.getByText("読み込み中…")).toBeInTheDocument();
    expect(await screen.findByText("まだ記録がありません。")).toBeInTheDocument();
  });

  it("記録するボタンでPOSTし、一覧に反映する", async () => {
    const user = userEvent.setup();
    render(<EmCheckinWidget />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: "記録する" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/em-self/checkins",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    expect(await screen.findByRole("table")).toBeInTheDocument();
  });

  it("日付を変えてPOSTできる", async () => {
    const user = userEvent.setup();
    render(<EmCheckinWidget />);
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
    render(<CheckinFormWithController onSubmitted={onSubmitted} />);
    await user.click(screen.getByRole("button", { name: "記録する" }));
    await waitFor(() => expect(onSubmitted).toHaveBeenCalledWith(expect.objectContaining({ id: "new" })));
  });

  it("失敗時はエラーメッセージを表示する", async () => {
    fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        return { ok: false, json: async () => ({ error: "記録に失敗しました" }) };
      }
      return { json: async () => ({ checkins: [] }) };
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<EmCheckinWidget />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: "記録する" }));
    expect(await screen.findByText("記録に失敗しました")).toBeInTheDocument();
  });
});
