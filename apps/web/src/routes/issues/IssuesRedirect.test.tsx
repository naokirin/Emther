import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { IssuesRedirect } from "./IssuesRedirect";
import { IssueDetailRedirect } from "./IssueDetailRedirect";

// 課題タブは提案に統合済み（/issues → /suggestions）
describe("IssuesRedirect / IssueDetailRedirect", () => {
  it("/issues は /suggestions へリダイレクトする", () => {
    render(
      <MemoryRouter initialEntries={["/issues"]}>
        <Routes>
          <Route path="/issues" element={<IssuesRedirect />} />
          <Route path="/suggestions" element={<div>提案一覧</div>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText("提案一覧")).toBeInTheDocument();
  });

  it("/issues/:id は /suggestions/:id へリダイレクトする", () => {
    render(
      <MemoryRouter initialEntries={["/issues/abc123"]}>
        <Routes>
          <Route path="/issues/:id" element={<IssueDetailRedirect />} />
          <Route path="/suggestions/:id" element={<div>提案詳細</div>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText("提案詳細")).toBeInTheDocument();
  });
});
