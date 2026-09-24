import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { IssuesRedirect } from "./IssuesRedirect";
import { IssueDetailRedirect } from "./IssueDetailRedirect";

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

// 課題タブは提案に統合済み（/issues → /suggestions）
describe("IssuesRedirect / IssueDetailRedirect", () => {
  it("/issues は /suggestions へリダイレクトする", async () => {
    render(
      <MemoryRouter initialEntries={["/issues"]}>
        <IssuesRedirect />
        <LocationProbe />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/suggestions"));
  });

  it("/issues/:id は /suggestions/:id へリダイレクトする", async () => {
    render(
      <MemoryRouter initialEntries={["/issues/abc123"]}>
        <IssueDetailRedirect />
        <LocationProbe />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/suggestions/abc123"));
  });
});
