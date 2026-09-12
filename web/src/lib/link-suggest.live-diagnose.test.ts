import { describe, expect, it } from "vitest";

// 実データ診断用。EM_LIVE_DIAGNOSE=1 のときだけ実行する（CI ではスキップ）。
// 例: EM_LIVE_DIAGNOSE=1 npm test -- --run src/lib/link-suggest.live-diagnose.test.ts

describe("link-suggest live diagnose", () => {
  it("旧実装どおり toThemeView でプロンプトを組むと実名ガードに掛かることを確認", async () => {
    if (process.env.EM_LIVE_DIAGNOSE !== "1") {
      expect(true).toBe(true);
      return;
    }

    const { listAdoptedThemes, toThemeView } = await import("@/lib/theme-store");
    const { assertNoRealNamesLeaked } = await import("@/lib/people-directory");
    const themes = listAdoptedThemes();
    const unmaskedBlock = themes
      .map((t) => {
        const v = toThemeView(t);
        return `- themeId=${t.id} ${v.title} — ${v.summary}`;
      })
      .join("\n");
    const maskedBlock = themes.map((t) => `- themeId=${t.id} ${t.title} — ${t.summary}`).join("\n");

    let unmaskedThrows = false;
    try {
      assertNoRealNamesLeaked(unmaskedBlock);
    } catch {
      unmaskedThrows = true;
    }
    let maskedThrows = false;
    try {
      assertNoRealNamesLeaked(maskedBlock);
    } catch {
      maskedThrows = true;
    }

    console.warn(
      "[diagnose-name-guard]",
      JSON.stringify({
        adoptedThemeCount: themes.length,
        unmaskedPromptWouldFailNameGuard: unmaskedThrows,
        maskedPromptWouldFailNameGuard: maskedThrows,
      }),
    );

    if (unmaskedThrows) {
      expect(maskedThrows).toBe(false);
    }
  });

  it(
    "実ストアで suggestIssueStrategyLinks を実行し source / fallbackReason を出す",
    async () => {
      if (process.env.EM_LIVE_DIAGNOSE !== "1") {
        expect(true).toBe(true);
        return;
      }

      const { suggestIssueStrategyLinks } = await import("@/lib/link-suggest");
      const started = Date.now();
      const result = await suggestIssueStrategyLinks();
      const elapsedMs = Date.now() - started;

      console.warn(
        "[diagnose-suggest]",
        JSON.stringify({
          elapsedMs,
          source: result.source,
          targetCount: result.targetCount,
          suggestionCount: result.suggestions.length,
          fallbackReason: result.fallbackReason ?? null,
          sampleRationale: result.suggestions[0]?.rationale?.slice(0, 80) ?? null,
        }),
      );

      expect(result.targetCount).toBeGreaterThanOrEqual(0);
    },
    180_000,
  );
});
