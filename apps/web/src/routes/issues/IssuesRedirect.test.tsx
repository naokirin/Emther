import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { IssuesRedirect } from "./IssuesRedirect";
import { IssueDetailRedirect } from "./IssueDetailRedirect";

// web/src/app/issues/page.tsx・[id]/page.tsx（Next.js版）からの移植（フェーズ3.5 tier1）。
// docs/2nd_pivot_version.md Phase 7で課題タブは提案に統合済み。
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
