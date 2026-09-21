import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { ThemesPanel } from "./ThemesPanel";
import type { Goal, OrgTheme } from "@emther/core/types";

// web/src/components/dashboard/ThemesPanel.tsx（Next.js版）には専用テストが元々無かった
// ため新規に追加する（フェーズ3.5 tier5 dashboardバッチ）。

function theme(overrides: Partial<OrgTheme> & { id: string }): OrgTheme {
  return {
    title: "テーマA",
    summary: "要約",
    rationale: "なぜこの結果に至ったか",
    facts: [],
    evidenceJournalIds: [],
    evidenceSuggestionIds: [],
    goalIds: [],
    status: "adopted",
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function renderPanel(props: Partial<React.ComponentProps<typeof ThemesPanel>> = {}) {
  const defaults: React.ComponentProps<typeof ThemesPanel> = {
    themes: [],
    themesLoaded: true,
    goals: [] as Goal[],
    refreshThemes: vi.fn().mockResolvedValue(undefined),
    refreshRuns: vi.fn().mockResolvedValue(undefined),
    onNavigate: vi.fn(),
  };
  return render(
    <MemoryRouter>
      <ThemesPanel {...defaults} {...props} />
    </MemoryRouter>,
  );
}

describe("ThemesPanel", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) })));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("採用中のテーマが無ければ見直し導線を表示する", () => {
    renderPanel();
    expect(screen.getByText(/採用中の優先テーマはまだありません/)).toBeInTheDocument();
  });

  it("採用中のテーマがあれば件数と焦点を要約表示する", () => {
    renderPanel({ themes: [theme({ id: "t1", title: "1on1の質" })] });
    expect(screen.getByText(/🎯 優先テーマ（1）/)).toBeInTheDocument();
    expect(screen.getByText(/1on1の質/)).toBeInTheDocument();
  });

  it("Goal未リンクなテーマは警告件数を表示する", () => {
    renderPanel({ themes: [theme({ id: "t1", goalIds: [] })] });
    expect(screen.getByText(/⚠ Goal未リンク 1件/)).toBeInTheDocument();
  });

  it("「詳細を見る」でテーマ一覧が展開される", async () => {
    const user = userEvent.setup();
    renderPanel({ themes: [theme({ id: "t1", title: "1on1の質", summary: "要約テキスト" })] });
    await user.click(screen.getByRole("button", { name: "詳細を見る" }));
    expect(screen.getByText("要約テキスト")).toBeInTheDocument();
    expect(screen.getByText("⚠ Goal未リンク")).toBeInTheDocument();
  });

  it("テーマの「詳細」トグルで根拠・根本原因を表示する", async () => {
    const user = userEvent.setup();
    renderPanel({
      themes: [
        theme({
          id: "t1",
          rationale: "なぜこの結果に至ったかの説明",
          rootCause: "根本原因の説明",
          facts: ["ファクト1"],
        }),
      ],
    });
    await user.click(screen.getByRole("button", { name: "詳細を見る" }));
    await user.click(screen.getByRole("button", { name: "詳細" }));
    expect(screen.getByText("なぜこの結果に至ったかの説明")).toBeInTheDocument();
    expect(screen.getByText(/根本原因の説明/)).toBeInTheDocument();
    expect(screen.getByText("ファクト1")).toBeInTheDocument();
  });

  it("採用を取り消すとdismissをPATCHしrefreshThemesを呼ぶ", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
    vi.stubGlobal("fetch", fetchMock);
    const refreshThemes = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPanel({ themes: [theme({ id: "t1" })], refreshThemes });
    await user.click(screen.getByRole("button", { name: "詳細を見る" }));
    await user.click(screen.getByRole("button", { name: "詳細" }));
    await user.click(screen.getByRole("button", { name: "採用を取り消す" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/themes/t1",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ action: "dismiss" }) }),
    );
    expect(refreshThemes).toHaveBeenCalled();
  });
});
