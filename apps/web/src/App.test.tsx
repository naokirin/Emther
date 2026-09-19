import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { App } from "./App";

describe("App", () => {
  it("骨組みの見出しを表示する", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: "Emther" })).toBeInTheDocument();
  });
});
