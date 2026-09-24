import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { MaskCheckPage } from "./MaskCheckPage";

// quick→aiの2段階フェッチが順に反映されることを確認する
function renderPage() {
  return render(
    <MemoryRouter>
      <MaskCheckPage />
    </MemoryRouter>,
  );
}

describe("MaskCheckPage", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(init.body as string) : {};
      if (body.phase === "quick") {
        return {
          ok: true,
          json: async () => ({
            phase: "quick",
            sourceText: "山田さんと打ち合わせした",
            maskedText: "{{PERSON_1}}と打ち合わせした",
            nameReplacements: [{ from: "山田さん", to: "{{PERSON_1}}", count: 1 }],
            unregisteredNameCandidates: [],
            sensitiveFindings: [],
            highlights: [],
            truncated: false,
            inputCharCount: 12,
            disclaimer: "これは目安です",
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          phase: "ai",
          unregisteredNameCandidates: ["鈴木"],
          sensitiveFindings: [],
          highlights: [],
          aiScopeNote: "ローカルAIでの追加確認は完了しました",
          disclaimer: "これは目安です",
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("チェックすると人名マスク結果を表示し、続けてローカルAIの結果も反映する", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText("確認したいテキスト"), "山田さんと打ち合わせした");
    await user.click(screen.getByRole("button", { name: "チェックする" }));

    expect(await screen.findByText("{{PERSON_1}}と打ち合わせした")).toBeInTheDocument();
    expect(
      screen.getByText((_, el) => el?.tagName === "LI" && (el.textContent ?? "").includes("山田さん") && (el.textContent ?? "").includes("PERSON_1")),
    ).toBeInTheDocument();

    await waitFor(() => expect(screen.getByText("ローカルAIでの追加確認は完了しました")).toBeInTheDocument());
    expect(screen.getByText("鈴木")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("quickフェーズが失敗するとエラーメッセージを表示する", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error: "チェックに失敗しました" }) });
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText("確認したいテキスト"), "テスト");
    await user.click(screen.getByRole("button", { name: "チェックする" }));

    expect(await screen.findByText("チェックに失敗しました")).toBeInTheDocument();
  });
});
