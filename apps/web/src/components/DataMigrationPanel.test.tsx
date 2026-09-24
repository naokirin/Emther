import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DataMigrationPanel } from "./DataMigrationPanel";

describe("DataMigrationPanel", () => {
  beforeEach(() => {
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("バックアップボタンでPOSTする", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "Content-Disposition": 'attachment; filename="emther-state.tar.gz"' }),
      blob: async () => new Blob(["dummy"]),
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("URL", { createObjectURL: vi.fn().mockReturnValue("blob:mock"), revokeObjectURL: vi.fn() });
    const user = userEvent.setup();
    render(<DataMigrationPanel />);
    await user.click(screen.getByRole("button", { name: "バックアップをダウンロード" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/settings/data/backup", expect.objectContaining({ method: "POST" })),
    );
  });

  it("RESETと入力しないとリセットボタンが無効", () => {
    render(<DataMigrationPanel />);
    expect(screen.getByRole("button", { name: "全データを削除する" })).toBeDisabled();
  });

  it("RESETと入力しリセットすると完了画面（再起動案内）を表示する", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    const user = userEvent.setup();
    render(<DataMigrationPanel />);
    await user.type(screen.getByLabelText("確認入力"), "RESET");
    await user.click(screen.getByRole("button", { name: "全データを削除する" }));
    expect(await screen.findByText("リセットが完了しました")).toBeInTheDocument();
  });
});
