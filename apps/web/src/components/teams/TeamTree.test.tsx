import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { buildTeamTree } from "./buildTeamTree";
import { TeamTreeView } from "./TeamTree";
import type { Team } from "@emther/core/types";

function makeTeam(overrides: Partial<Team> & Pick<Team, "id" | "name">): Team {
  return {
    members: [],
    charter: { mission: "", constraints: "" },
    managedByEm: true,
    aliases: [],
    archived: false,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe("buildTeamTree", () => {
  it("「/」区切りのチーム名をネストしたツリーに分解する", () => {
    const teams = [makeTeam({ id: "t1", name: "Engineering/Team A" }), makeTeam({ id: "t2", name: "Design" })];
    const tree = buildTeamTree(teams);
    const engineering = tree.find((n) => n.segment === "Engineering");
    expect(engineering).toBeDefined();
    expect(engineering!.team).toBeUndefined();
    expect(engineering!.children[0].segment).toBe("Team A");
    expect(engineering!.children[0].team?.id).toBe("t1");
    expect(tree.find((n) => n.segment === "Design")?.team?.id).toBe("t2");
  });
});

describe("TeamTreeView", () => {
  it("チームをクリックするとonSelectが呼ばれる", async () => {
    const onSelect = vi.fn();
    const team = makeTeam({ id: "t1", name: "Design", members: ["Aさん"] });
    const user = userEvent.setup();
    render(<TeamTreeView nodes={buildTeamTree([team])} depth={0} selectedTeamId={null} onSelect={onSelect} />);
    await user.click(screen.getByText(/Design（1名）/));
    expect(onSelect).toHaveBeenCalledWith(team);
  });

  it("アーカイブ済みチームには🗄マークを表示する", () => {
    const team = makeTeam({ id: "t1", name: "Design", archived: true });
    render(<TeamTreeView nodes={buildTeamTree([team])} depth={0} selectedTeamId={null} onSelect={vi.fn()} />);
    expect(screen.getByText(/🗄/)).toBeInTheDocument();
  });
});
