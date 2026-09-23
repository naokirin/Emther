import { describe, expect, it } from "vitest";
import {
  agentRunMutationResponseSchema,
  agentsResponseSchema,
  emCheckinsResponseSchema,
  idResolveResponseSchema,
  journalCreateResponseSchema,
  journalListResponseSchema,
  journalPostBodySchema,
  maskCheckAiResponseSchema,
  maskCheckPostBodySchema,
  maskCheckQuickResponseSchema,
  modelsStatusResponseSchema,
  okResponseSchema,
  settingsRulesPatchSchema,
  suggestionMutationResponseSchema,
  suggestionsResponseSchema,
  teamsPostBodySchema,
  teamsResponseSchema,
  timelineResponseSchema,
  vitalsResponseSchema,
} from "./index";

describe("@emther/api-contract 寛容パース（既存 journal/settings 方針）", () => {
  it("journal POST: 不正型フィールドは未指定扱い、オブジェクト以外も {} に落とす", () => {
    expect(journalPostBodySchema.parse(null)).toEqual({});
    expect(journalPostBodySchema.parse({ text: 1, people: "x" })).toEqual({
      text: undefined,
      people: undefined,
      occurredAtDate: undefined,
      teams: undefined,
      teamIds: undefined,
    });
  });

  it("settings/rules PATCH: 不正な number/boolean は未指定扱い", () => {
    const parsed = settingsRulesPatchSchema.parse({
      teamWindowDays: "7",
      autoMorningSummaryEnabled: 1,
    });
    expect(parsed.teamWindowDays).toBeUndefined();
    expect(parsed.autoMorningSummaryEnabled).toBeUndefined();
  });

  it("teams POST: 不正型は未指定扱い", () => {
    expect(teamsPostBodySchema.parse(null)).toEqual({});
    expect(teamsPostBodySchema.parse({ name: 1, members: "x", managedByEm: "yes" })).toEqual({
      name: undefined,
      members: undefined,
      managedByEm: undefined,
    });
  });
});

describe("@emther/api-contract timeline レスポンス（厳密）", () => {
  it("正しい形を受理する", () => {
    const data = {
      entries: [
        {
          id: "e1",
          entityType: "journal" as const,
          text: "hello",
          occurredAt: 1,
        },
      ],
    };
    expect(timelineResponseSchema.parse(data)).toEqual(data);
  });

  it("不正な entityType は拒否する", () => {
    expect(() =>
      timelineResponseSchema.parse({
        entries: [{ id: "e1", entityType: "nope", text: "x", occurredAt: 1 }],
      }),
    ).toThrow();
  });
});

describe("@emther/api-contract GET レスポンス（新規）", () => {
  it("em-self/checkins: 正しい形を受理する", () => {
    const data = {
      checkins: [{ id: "c1", mood: 3, energy: 3, stress: 2, note: "", createdAt: 1 }],
    };
    expect(emCheckinsResponseSchema.parse(data)).toEqual(data);
  });

  it("teams: members 欠落は拒否する", () => {
    expect(() =>
      teamsResponseSchema.parse({
        teams: [
          {
            id: "t1",
            name: "A",
            charter: { mission: "", constraints: "" },
            archived: false,
            managedByEm: true,
            aliases: [],
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      }),
    ).toThrow();
  });

  it("journal list: 必須フィールドを受理し、余分なキーは残す", () => {
    const data = {
      entries: [
        {
          id: "j1",
          rawText: "x",
          tags: [],
          people: [],
          teamIds: [],
          urgency: "low" as const,
          sentiment: "neutral" as const,
          summary: "",
          createdAt: 1,
          confirmed: false,
          archivedAt: 99,
        },
      ],
    };
    const parsed = journalListResponseSchema.parse(data);
    expect(parsed.entries[0]?.id).toBe("j1");
    expect((parsed.entries[0] as { archivedAt?: number }).archivedAt).toBe(99);
  });

  it("suggestions: reviewStatus 不正は拒否する", () => {
    expect(() =>
      suggestionsResponseSchema.parse({
        suggestions: [
          {
            id: "s1",
            title: "t",
            reviewStatus: "nope",
            confirmPriority: "normal",
            memos: [],
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      }),
    ).toThrow();
  });

  it("agents: エンベロープ必須キーを受理する", () => {
    const data = {
      runs: [
        {
          id: "r1",
          agentName: "Lead Agent",
          task: "t",
          status: "idle" as const,
          log: [],
          totalCostUsd: 0,
          createdAt: 1,
          updatedAt: 1,
          origin: "manual" as const,
          reviewed: true,
        },
      ],
      pendingAgentStarts: [],
      pendingUnmaskedSends: [],
    };
    expect(agentsResponseSchema.parse(data)).toMatchObject(data);
  });

  it("vitals: エンベロープ無しの OrgVitals を受理する", () => {
    const data = {
      teams: [],
      oneOnOneCoverage: {
        status: "unknown" as const,
        covered: 0,
        total: 0,
        reason: "",
        uncoveredMembers: [],
      },
    };
    expect(vitalsResponseSchema.parse(data)).toEqual(data);
  });
});

describe("@emther/api-contract ミューテーション（POST/PATCH/DELETE）レスポンス（新規）", () => {
  it("OkResponse: DELETE 等の成功のみエンベロープを受理する", () => {
    expect(okResponseSchema.parse({ ok: true })).toEqual({ ok: true });
  });

  it("OkResponse: ok が true 以外は拒否する", () => {
    expect(() => okResponseSchema.parse({ ok: false })).toThrow();
  });

  it("JournalCreateResponse: entry 必須、nameCandidates/profileCandidate は任意", () => {
    const data = {
      entry: {
        id: "j1",
        rawText: "x",
        tags: [],
        people: [],
        teamIds: [],
        urgency: "low" as const,
        sentiment: "neutral" as const,
        summary: "",
        createdAt: 1,
        confirmed: false,
      },
    };
    const parsed = journalCreateResponseSchema.parse(data);
    expect(parsed.entry.id).toBe("j1");
    expect(parsed.nameCandidates).toBeUndefined();
    expect(parsed.profileCandidate).toBeUndefined();
  });

  it("SuggestionMutationResponse: suggestion 必須フィールドを受理する", () => {
    const data = {
      suggestion: {
        id: "s1",
        title: "t",
        reviewStatus: "unreviewed" as const,
        confirmPriority: "normal" as const,
        memos: [],
        createdAt: 1,
        updatedAt: 1,
      },
    };
    expect(suggestionMutationResponseSchema.parse(data)).toMatchObject(data);
  });

  it("SuggestionMutationResponse: suggestion 欠落は拒否する", () => {
    expect(() => suggestionMutationResponseSchema.parse({})).toThrow();
  });

  it("AgentRunMutationResponse: run 必須フィールドを受理する", () => {
    const data = {
      run: {
        id: "r1",
        agentName: "Lead Agent",
        task: "t",
        status: "idle" as const,
        log: [],
        totalCostUsd: 0,
        createdAt: 1,
        updatedAt: 1,
        origin: "manual" as const,
        reviewed: true,
      },
    };
    expect(agentRunMutationResponseSchema.parse(data)).toMatchObject(data);
  });
});

describe("@emther/api-contract 新規エンベロープ（id-resolve / models-status / mask-check）", () => {
  it("id-resolve: matches 配列を受理する", () => {
    const data = {
      matches: [{ kind: "suggestion" as const, id: "abc", label: "題", href: "/suggestions/abc" }],
    };
    expect(idResolveResponseSchema.parse(data)).toEqual(data);
  });

  it("id-resolve: kind 不正は拒否する", () => {
    expect(() =>
      idResolveResponseSchema.parse({
        matches: [{ kind: "nope", id: "a", label: "l", href: "/x" }],
      }),
    ).toThrow();
  });

  it("models-status: ModelLoadSnapshot 形を受理する", () => {
    const data = {
      overall: "ready" as const,
      models: [
        {
          key: "chat" as const,
          label: "Chat",
          modelId: "mock/chat",
          phase: "ready" as const,
          progress: 100,
          loadedBytes: null,
          totalBytes: null,
          cached: true,
          error: null,
        },
      ],
    };
    expect(modelsStatusResponseSchema.parse(data)).toEqual(data);
  });

  it("mask-check POST body: text 必須・phase 不正は未指定", () => {
    expect(maskCheckPostBodySchema.parse({ text: "hello", phase: "nope" })).toMatchObject({
      text: "hello",
      phase: undefined,
    });
    expect(() => maskCheckPostBodySchema.parse({ text: 1 })).toThrow();
  });

  it("mask-check quick/ai レスポンス: 必須フィールドを受理する", () => {
    const quick = {
      phase: "quick" as const,
      sourceText: "x",
      maskedText: "x",
      nameReplacements: [],
      unregisteredNameCandidates: [],
      sensitiveFindings: [],
      highlights: [],
      truncated: false,
      inputCharCount: 1,
      disclaimer: "d",
    };
    expect(maskCheckQuickResponseSchema.parse(quick)).toMatchObject(quick);

    const ai = {
      phase: "ai" as const,
      unregisteredNameCandidates: [],
      sensitiveFindings: [],
      highlights: [],
      aiScopeNote: "n",
      aiWeak: false,
      disclaimer: "d",
    };
    expect(maskCheckAiResponseSchema.parse(ai)).toMatchObject(ai);
  });
});
