import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { GoByIdPrefixPage } from "./GoByIdPrefixPage";
import type { IdMatch } from "@emther/core/id-resolve";

// fetchをモックして3分岐（0件/1件/複数件）+ 不正プレフィックスを検証する
function renderAt(prefix: string) {
  return render(
    <MemoryRouter initialEntries={[`/go/${prefix}`]}>
      <Routes>
        <Route path="/go/:prefix" element={<GoByIdPrefixPage />} />
        <Route path="/suggestions/:id" element={<div>提案詳細ページ</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

function mockMatches(matches: IdMatch[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ json: () => Promise.resolve({ matches }) }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GoByIdPrefixPage", () => {
  it("十六進のプレフィックスでない場合はエラー表示のみでfetchしない", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    renderAt("not-hex");
    expect(screen.getByRole("heading", { name: "IDを解決できません" })).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("一致件数0件なら未一致メッセージを表示する", async () => {
    mockMatches([]);
    renderAt("abcdef12");
    await waitFor(() => expect(screen.getByRole("heading", { name: "一致する項目がありません" })).toBeInTheDocument());
  });

  it("一致件数1件ならそのhrefへ自動遷移する", async () => {
    mockMatches([{ kind: "suggestion", id: "abcdef1234567890", label: "サンプル提案", href: "/suggestions/abcdef1234567890" }]);
    renderAt("abcdef12");
    await waitFor(() => expect(screen.getByText("提案詳細ページ")).toBeInTheDocument());
  });

  it("一致件数が複数なら候補一覧を表示する", async () => {
    mockMatches([
      { kind: "suggestion", id: "abcdef1234567890", label: "提案A", href: "/suggestions/abcdef1234567890" },
      { kind: "journal", id: "abcdef1234567891", label: "Journal B", href: "/journal?focus=abcdef1234567891" },
    ]);
    renderAt("abcdef12");
    await waitFor(() => expect(screen.getByRole("heading", { name: "候補が複数あります" })).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "提案A" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Journal B" })).toBeInTheDocument();
  });
});
