import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "@/router";
import { TeamEditPanel } from "./TeamEditPanel";
import type { Suggestion, JournalEntry, Team } from "@emther/core/types";

const team: Team = {
  id: "t1",
  name: "Design",
  members: ["Aさん"],
  charter: { mission: "デザインの一貫性を保つ", constraints: "" },
  managedByEm: true,
  aliases: [],
  archived: false,
  createdAt: 0,
  updatedAt: 0,
};

function renderPanel(overrides: Partial<React.ComponentProps<typeof TeamEditPanel>> = {}) {
  return render(
    <MemoryRouter>
      <TeamEditPanel
        selectedTeam={team}
        suggestions={[]}
        journalEntries={[]}
        teamHistory={[]}
        refreshTeams={vi.fn().mockResolvedValue(undefined)}
        onRemoved={vi.fn()}
        {...overrides}
      />
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("TeamEditPanel", () => {
  it("未選択のときは案内文だけを表示する", () => {
    render(
      <MemoryRouter>
        <TeamEditPanel selectedTeam={null} suggestions={[]} journalEntries={[]} teamHistory={[]} refreshTeams={vi.fn()} onRemoved={vi.fn()} />
      </MemoryRouter>,
    );
    expect(screen.getByText("左のツリーからチームを選択してください。")).toBeInTheDocument();
  });

  it("選択中チームの内容でフォームが初期化され、未変更なら保存ボタンは無効", () => {
    renderPanel();
    expect(screen.getByLabelText("チーム名")).toHaveValue("Design");
    expect(screen.getByRole("button", { name: "保存済み" })).toBeDisabled();
  });

  it("変更するとPATCHで保存できる", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    const refreshTeams = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPanel({ refreshTeams });

    await user.clear(screen.getByLabelText("チーム名"));
    await user.type(screen.getByLabelText("チーム名"), "Design Team");
    const saveBtn = screen.getByRole("button", { name: "保存" });
    expect(saveBtn).toBeEnabled();
    await user.click(saveBtn);

    await waitFor(() => expect(refreshTeams).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith("/api/teams/t1", expect.objectContaining({ method: "PATCH" }));
  });

  it("アーカイブする／削除するでそれぞれ対応するAPIを叩く", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    const onRemoved = vi.fn();
    const user = userEvent.setup();
    renderPanel({ onRemoved });

    await user.click(screen.getByRole("button", { name: "アーカイブする" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/teams/t1/archive", expect.objectContaining({ method: "POST" })));

    await user.click(screen.getByRole("button", { name: "このチームを削除" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/teams/t1", expect.objectContaining({ method: "DELETE" })));
    expect(onRemoved).toHaveBeenCalledTimes(1);
  });

  it("メンバー名一致で関連提案・関連Journalを抽出して表示する", () => {
    const suggestions: Suggestion[] = [
      {
        id: "i1",
        title: "Aさんの評価面談",
        memos: [],
      } as unknown as Suggestion,
    ];
    const journalEntries: JournalEntry[] = [
      {
        id: "j1",
        rawText: "Aさんと1on1",
        people: ["Aさん"],
        teamIds: [],
        tags: [],
        urgency: "low",
        sentiment: "neutral",
        createdAt: 1,
      } as unknown as JournalEntry,
    ];
    renderPanel({ suggestions, journalEntries });
    expect(screen.getByText("Aさんの評価面談")).toBeInTheDocument();
    expect(screen.getByText("Aさんと1on1")).toBeInTheDocument();
  });
});
