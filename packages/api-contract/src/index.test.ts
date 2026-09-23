import { describe, expect, it } from "vitest";
import { journalPostBodySchema, settingsRulesPatchSchema, timelineResponseSchema } from "./index";

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
