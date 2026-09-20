import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { useNameCandidateConfirm } from "./useNameCandidateConfirm";
import { NAME_CANDIDATE_CONFIRMATION_CODE } from "@emther/core/name-candidate-confirmation";

// web/src/lib/useNameCandidateConfirm.tsx（Next.js版）には専用テストが元々無かったため
// 新規に追加する（フェーズ3.5 evening-reviewバッチ。DailyReflectionFormが利用する）。
// ダイアログ本体のクリック操作を検証するため、DOM描画込みの簡易ハーネスで確認する。
function Harness({ actionLabel = "保存する" }: { actionLabel?: string }) {
  const { fetchWithNameConfirm, nameCandidateDialog } = useNameCandidateConfirm();
  const [result, setResult] = useState("idle");

  async function handleClick() {
    try {
      const { res } = await fetchWithNameConfirm("/api/journal", { body: { text: "山田太郎さんと話した" } }, actionLabel);
      setResult(res.ok ? "ok" : "error");
    } catch (err) {
      setResult((err as Error).message);
    }
  }

  return (
    <div>
      <button onClick={() => void handleClick()}>送信</button>
      <p data-testid="result">{result}</p>
      {nameCandidateDialog}
    </div>
  );
}

function confirmationResponse(candidates: string[]) {
  return {
    ok: false,
    status: 409,
    json: async () => ({ code: NAME_CANDIDATE_CONFIRMATION_CODE, candidates, message: "確認してください" }),
  };
}

describe("useNameCandidateConfirm", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("409以外は確認ダイアログを出さずそのまま結果を返す", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) }));
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "送信" }));
    await waitFor(() => expect(screen.getByTestId("result")).toHaveTextContent("ok"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("409のとき「人名として登録して保存する」を選ぶとregisterNameCandidates付きで再送する", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(confirmationResponse(["山田太郎"]))
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: "送信" }));
    await screen.findByRole("dialog", { name: "未登録の人名候補" });
    expect(screen.getByText("山田太郎")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "人名として登録して保存する" }));
    await waitFor(() => expect(screen.getByTestId("result")).toHaveTextContent("ok"));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(secondBody).toEqual(expect.objectContaining({ registerNameCandidates: true }));
  });

  it("「このまま保存する」を選ぶとallowUnmaskedNameCandidates付きで再送する", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(confirmationResponse(["山田太郎"]))
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: "送信" }));
    await screen.findByRole("dialog", { name: "未登録の人名候補" });
    await user.click(screen.getByRole("button", { name: "このまま保存する" }));
    await waitFor(() => expect(screen.getByTestId("result")).toHaveTextContent("ok"));

    const secondBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(secondBody).toEqual(expect.objectContaining({ allowUnmaskedNameCandidates: true }));
  });

  it("キャンセルすると再送せず、キャンセルメッセージを結果に反映する", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(confirmationResponse(["山田太郎"]));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: "送信" }));
    await screen.findByRole("dialog", { name: "未登録の人名候補" });
    await user.click(screen.getByRole("button", { name: "キャンセル" }));

    await waitFor(() => expect(screen.getByTestId("result")).toHaveTextContent("人名候補の確認をキャンセルしました"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
