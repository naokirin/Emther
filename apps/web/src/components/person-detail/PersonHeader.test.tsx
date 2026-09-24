import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PersonHeader } from "./PersonHeader";
import type { PersonProfile } from "@emther/core/types";

// web/src/components/person-detail/PersonHeader.tsx（Next.js版）には専用テストが
// 元々無かったため新規に追加する（フェーズ3.5 tier2、人物バッチ）。
const person: PersonProfile = {
  id: "p1",
  name: "田中さん",
  aliases: [],
  teamNames: ["Design"],
  trend: { positive: 2, negative: 0, neutral: 0 },
  factCount: 2,
  isDirectReport: true,
  isSelf: false,
  hasConcerningSuggestion: false,
  archived: false,
  facts: [],
  interpretations: [],
  relatedSuggestions: [],
};

function renderHeader(overrides: Partial<PersonProfile> = {}) {
  const refreshPerson = vi.fn().mockResolvedValue(undefined);
  const refreshPeople = vi.fn().mockResolvedValue(undefined);
  const onDeleted = vi.fn();
  render(
    <PersonHeader person={{ ...person, ...overrides }} refreshPerson={refreshPerson} refreshPeople={refreshPeople} onDeleted={onDeleted} />,
  );
  return { refreshPerson, refreshPeople, onDeleted };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PersonHeader", () => {
  it("名前・部下ラベル・所属チームを表示する", () => {
    renderHeader();
    expect(screen.getByRole("heading", { name: "田中さん" })).toBeInTheDocument();
    expect(screen.getByText(/部下/)).toBeInTheDocument();
    expect(screen.getByText(/所属: Design/)).toBeInTheDocument();
  });

  it("名前を変更してPATCHし、成功後にrefreshPerson/refreshPeopleを呼ぶ", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    const user = userEvent.setup();
    const { refreshPerson, refreshPeople } = renderHeader();

    await user.click(screen.getByRole("button", { name: "名前を変更" }));
    const input = screen.getByLabelText("表示名");
    await user.clear(input);
    await user.type(input, "田中太郎");
    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(refreshPerson).toHaveBeenCalledTimes(1));
    expect(refreshPeople).toHaveBeenCalledTimes(1);
  });

  it("誤登録として削除するとDELETEしonDeletedを呼ぶ", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    const { onDeleted } = renderHeader();

    await user.click(screen.getByRole("button", { name: "誤登録として削除" }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith("/api/people/p1", expect.objectContaining({ method: "DELETE" }));
  });

  it("自分として設定するとselfPersonIdをPATCHする", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderHeader();

    await user.click(screen.getByRole("button", { name: "自分として設定" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/settings/rules",
        expect.objectContaining({ method: "PATCH", body: JSON.stringify({ selfPersonId: "p1" }) }),
      ),
    );
  });

  it("アーカイブするとPOSTしrefreshPerson/refreshPeopleを呼ぶ", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    const { refreshPerson, refreshPeople } = renderHeader();

    await user.click(screen.getByRole("button", { name: "アーカイブする" }));
    await waitFor(() => expect(refreshPerson).toHaveBeenCalledTimes(1));
    expect(refreshPeople).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/people/p1/archive",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ archived: true }) }),
    );
  });
});
