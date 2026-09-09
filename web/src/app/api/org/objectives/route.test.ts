import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "@/lib/test-helpers/store-env";
import { jsonRequest } from "@/lib/test-helpers/api-route";

vi.mock("@/lib/local-model", () => ({
  runLocalChat: vi.fn(async () => JSON.stringify({ people: [] })),
  extractFirstJsonObject: (text: string) => text,
}));

let dir: string;

beforeEach(() => {
  dir = setupIsolatedStoreEnv();
  vi.resetModules();
});

afterEach(() => {
  teardownIsolatedStoreEnv(dir);
});

describe("GET /api/org/objectives", () => {
  it("進捗つきで一覧を返す", async () => {
    const orgStore = await import("@/lib/org-context-store");
    const issueStore = await import("@/lib/issue-store");
    const objective = await orgStore.addObjective("売上を伸ばす");
    const withKr = await orgStore.addKeyResult(objective.id, "新規契約10件");
    const krId = withKr!.keyResults[0].id;
    const issue = await issueStore.createIssue("契約A", undefined, undefined, undefined, undefined, krId);
    issueStore.setIssueArchived(issue.id, true);

    const route = await import("./route");
    const res = await route.GET();
    const json = await res.json();
    expect(json.objectives[0].progress[0]).toEqual({ keyResultId: krId, total: 1, done: 1 });
  });
});

describe("POST /api/org/objectives", () => {
  it("titleが無ければ400", async () => {
    const route = await import("./route");
    const res = await route.POST(jsonRequest("http://localhost/x", "POST", { title: "  " }));
    expect(res.status).toBe(400);
  });

  it("作成できる（201）", async () => {
    const route = await import("./route");
    const res = await route.POST(jsonRequest("http://localhost/x", "POST", { title: "新しいObjective" }));
    expect(res.status).toBe(201);
    expect((await res.json()).objective.title).toBe("新しいObjective");
  });

  // ユーザー要望「目標のカスケーディング構成」対応。
  it("teamIdを指定するとそのチームの目標として作成できる", async () => {
    const orgStore = await import("@/lib/org-context-store");
    const team = orgStore.addTeam("Team A", []);
    const route = await import("./route");
    const res = await route.POST(jsonRequest("http://localhost/x", "POST", { title: "チーム目標", teamId: team.id }));
    expect((await res.json()).objective.teamId).toBe(team.id);
  });

  it("teamIdを省略すると組織全体の目標になる", async () => {
    const route = await import("./route");
    const res = await route.POST(jsonRequest("http://localhost/x", "POST", { title: "組織目標" }));
    expect((await res.json()).objective.teamId).toBeUndefined();
  });
});
