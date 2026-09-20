import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TeamCreatePanel } from "./TeamCreatePanel";

// web/src/components/teams/TeamCreatePanel.tsx（Next.js版）には専用テストが元々無かったため
// 新規に追加する（フェーズ3.5 tier2、teamsバッチ）。
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("TeamCreatePanel", () => {
  it("チーム名・メンバーを入力して追加すると、onCreatedとrefreshTeamsが呼ばれる", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ team: { id: "t1", name: "Design", members: ["Aさん"] } }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const refreshTeams = vi.fn().mockResolvedValue(undefined);
    const onCreated = vi.fn();
    const user = userEvent.setup();

    render(<TeamCreatePanel refreshTeams={refreshTeams} onCreated={onCreated} />);
    await user.type(screen.getByLabelText("チーム名"), "Design");
    await user.type(screen.getByLabelText("メンバー（カンマ区切り）"), "Aさん");
    await user.click(screen.getByRole("button", { name: "追加" }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: "t1" })));
    expect(refreshTeams).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/teams",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ name: "Design", members: ["Aさん"] }) }),
    );
  });

  it("失敗時はエラーメッセージを表示する", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "チームの追加に失敗しました" }) }));
    const user = userEvent.setup();
    render(<TeamCreatePanel refreshTeams={vi.fn()} onCreated={vi.fn()} />);
    await user.type(screen.getByLabelText("チーム名"), "Design");
    await user.click(screen.getByRole("button", { name: "追加" }));
    expect(await screen.findByText("チームの追加に失敗しました")).toBeInTheDocument();
  });

  it("一括登録フォームからPOSTし、作成件数を表示する", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ teams: [{ id: "t1" }, { id: "t2" }], skipped: ["不正な行"] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const refreshTeams = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();

    render(<TeamCreatePanel refreshTeams={refreshTeams} onCreated={vi.fn()} />);
    await user.click(screen.getByText("複数チームを一括登録（初回投入用）"));
    await user.type(screen.getByLabelText(/1行1チーム/), "Design: Aさん");
    await user.click(screen.getByRole("button", { name: "一括登録" }));

    expect(await screen.findByText(/2件のチームを作成しました/)).toBeInTheDocument();
    expect(screen.getByText(/不正な行/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/teams/bulk", expect.objectContaining({ method: "POST" }));
  });
});
