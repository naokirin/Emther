import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "@core/test-helpers/store-env";

// findReferenceUrls/findReferenceUrlは実際にはclaude CLI（`--tools "WebSearch"`）または
// cursor-agent（専用サンドボックス+hooks）を子プロセス起動するが、テストではプロセスを
// 実際に起動せずnode:child_processのspawnを丸ごとモックする（agent-runtime.test.tsと同じ
// パターン）。
const spawnRef = vi.hoisted(() => ({
  impl: (() => {
    throw new Error("spawn is not mocked for this test");
  }) as (command: string, args: string[]) => unknown,
}));
vi.mock("node:child_process", () => ({
  spawn: (command: string, args: string[]) => spawnRef.impl(command, args),
}));

class FakeChildProcess extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn();
}

type SpawnCall = { command: string; args: string[]; child: FakeChildProcess };
let spawnCalls: SpawnCall[] = [];
let dir: string;

beforeEach(() => {
  // findReferenceUrlsは設定（cliOrderにclaudeが含まれるか）を見るため、settings-store
  // が実データ（.data/settings-rules.json）を読まないようにストアを分離する
  // （em-growth-store.test.ts等と同じ既存パターン）。
  dir = setupIsolatedStoreEnv();
  spawnCalls = [];
  spawnRef.impl = (command: string, args: string[]) => {
    const child = new FakeChildProcess();
    spawnCalls.push({ command, args, child });
    return child;
  };
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  teardownIsolatedStoreEnv(dir);
});

function emitResult(child: FakeChildProcess, resultText: string): void {
  child.stdout.emit("data", Buffer.from(JSON.stringify({ result: resultText })));
  child.emit("close", 0);
}

async function loadModule() {
  return import("@/lib/reference-lookup");
}

describe("findReferenceUrls", () => {
  // ユーザー指摘「Claudeのみは制約が強すぎるので緩和したい」対応で、claude/cursorどちらも
  // 対応CLIになった後の挙動を検証する。
  it("cliOrderにclaude/cursorどちらも含まれていない場合はCLIを起動せず空配列を返す", async () => {
    const settingsStore = await import("@core/settings-store");
    settingsStore.updateRulesAndConstraints({ cliOrder: ["agy"] });
    const rt = await loadModule();
    const results = await rt.findReferenceUrls([{ topic: "心理的安全性", isPrimarySource: false }]);
    expect(results).toEqual([]);
    expect(spawnCalls).toHaveLength(0);
  });

  it("cliOrderでclaudeがcursorより先に並んでいればclaudeを起動する", async () => {
    const settingsStore = await import("@core/settings-store");
    settingsStore.updateRulesAndConstraints({ cliOrder: ["claude", "cursor"] });
    const rt = await loadModule();
    const promise = rt.findReferenceUrls([{ topic: "心理的安全性", isPrimarySource: false }]);
    await vi.waitFor(() => {
      if (spawnCalls.length < 1) throw new Error("not spawned yet");
    });
    expect(spawnCalls[0].command).toBe("claude");
    emitResult(spawnCalls[0].child, '```url_lookup\n[{ "index": 1, "url": "https://example.com/psych-safety" }]\n```');
    await promise;
  });

  it("cliOrderでcursorがclaudeより先に並んでいればcursor-agentを起動する", async () => {
    const settingsStore = await import("@core/settings-store");
    settingsStore.updateRulesAndConstraints({ cliOrder: ["cursor", "claude"] });
    const rt = await loadModule();
    const promise = rt.findReferenceUrls([{ topic: "心理的安全性", isPrimarySource: false }]);
    await vi.waitFor(() => {
      if (spawnCalls.length < 1) throw new Error("not spawned yet");
    });
    expect(spawnCalls[0].command).toBe("cursor-agent");
    emitResult(spawnCalls[0].child, '```url_lookup\n[{ "index": 1, "url": "https://example.com/psych-safety" }]\n```');
    const results = await promise;
    expect(results).toEqual([{ topic: "心理的安全性", url: "https://example.com/psych-safety" }]);
  });

  it("cursor-agentを専用サンドボックス・force・named modelで起動し、hooksファイルを用意する", async () => {
    const settingsStore = await import("@core/settings-store");
    settingsStore.updateRulesAndConstraints({ cliOrder: ["cursor"] });
    const rt = await loadModule();
    const promise = rt.findReferenceUrls([{ topic: "心理的安全性", isPrimarySource: false }]);
    await vi.waitFor(() => {
      if (spawnCalls.length < 1) throw new Error("not spawned yet");
    });
    const { command, args } = spawnCalls[0];
    expect(command).toBe("cursor-agent");
    expect(args).toContain("--force");
    expect(args).toContain("--trust");
    expect(args[args.indexOf("--model") + 1]).toBe("gpt-5.2");
    expect(args[args.indexOf("--output-format") + 1]).toBe("json");
    // Autoモデルルーティングだと組み込みWebSearchへのpreToolUseフックが発火しない既知バグの
    // 回避策として、named modelを明示している（"--model auto"は使わない）。
    expect(args).not.toContain("auto");
    // フォールバック実行用（cli-runners/cursor.ts）とは別の専用ワークスペースであること
    // （同じディレクトリだとフォールバック実行までdeny-by-defaultの対象になってしまう）。
    const workspaceDir = args[args.indexOf("--workspace") + 1];
    expect(workspaceDir).toContain("cursor-websearch-sandbox");
    expect(workspaceDir).not.toBe("cursor-sandbox");

    // .cursor/hooks.json・フックスクリプトが実際に書き出されていること。
    const hooksJson = JSON.parse(readFileSync(join(workspaceDir, ".cursor", "hooks.json"), "utf8"));
    expect(hooksJson.hooks.preToolUse[0].command).toBe(".cursor/hooks/allow-websearch-only.sh");
    expect(hooksJson.hooks.preToolUse[0].failClosed).toBe(true);
    const scriptPath = join(workspaceDir, ".cursor", "hooks", "allow-websearch-only.sh");
    expect(existsSync(scriptPath)).toBe(true);
    const script = readFileSync(scriptPath, "utf8");
    expect(script).toContain("WebSearch|WebFetch");
    expect(script).toContain('"permission": "deny"');

    emitResult(spawnCalls[0].child, '```url_lookup\n[{ "index": 1, "url": "https://example.com/psych-safety" }]\n```');
    await promise;
  });

  // ユーザー要望「この検索で使うモデル設定を追加してほしい。他のタスクに比べても
  // コストが低く軽量なモデルで良いはず」対応。
  describe("この検索専用のモデル設定（referenceLookupClaudeModel/referenceLookupCursorModel）", () => {
    it("referenceLookupClaudeModelが設定されていればclaude起動時に--modelで渡す", async () => {
      const settingsStore = await import("@core/settings-store");
      settingsStore.updateRulesAndConstraints({ cliOrder: ["claude"], referenceLookupClaudeModel: "haiku" });
      const rt = await loadModule();
      const promise = rt.findReferenceUrls([{ topic: "心理的安全性", isPrimarySource: false }]);
      await vi.waitFor(() => {
        if (spawnCalls.length < 1) throw new Error("not spawned yet");
      });
      const args = spawnCalls[0].args;
      expect(args[args.indexOf("--model") + 1]).toBe("haiku");
      emitResult(spawnCalls[0].child, '```url_lookup\n[{ "index": 1 }]\n```');
      await promise;
    });

    it("referenceLookupClaudeModelが未設定ならclaude起動時に--modelを渡さない（CLIの既定のまま）", async () => {
      const rt = await loadModule();
      const promise = rt.findReferenceUrls([{ topic: "心理的安全性", isPrimarySource: false }]);
      await vi.waitFor(() => {
        if (spawnCalls.length < 1) throw new Error("not spawned yet");
      });
      expect(spawnCalls[0].args).not.toContain("--model");
      emitResult(spawnCalls[0].child, '```url_lookup\n[{ "index": 1 }]\n```');
      await promise;
    });

    it("referenceLookupCursorModelが設定されていればcursor-agent起動時にそのモデルを渡す", async () => {
      const settingsStore = await import("@core/settings-store");
      settingsStore.updateRulesAndConstraints({ cliOrder: ["cursor"], referenceLookupCursorModel: "gpt-custom" });
      const rt = await loadModule();
      const promise = rt.findReferenceUrls([{ topic: "心理的安全性", isPrimarySource: false }]);
      await vi.waitFor(() => {
        if (spawnCalls.length < 1) throw new Error("not spawned yet");
      });
      const args = spawnCalls[0].args;
      expect(args[args.indexOf("--model") + 1]).toBe("gpt-custom");
      emitResult(spawnCalls[0].child, '```url_lookup\n[{ "index": 1 }]\n```');
      await promise;
    });

    it("referenceLookupCursorModelが未設定ならcursor-agent起動時は既定モデル（gpt-5.2）を渡す", async () => {
      const settingsStore = await import("@core/settings-store");
      settingsStore.updateRulesAndConstraints({ cliOrder: ["cursor"] });
      const rt = await loadModule();
      const promise = rt.findReferenceUrls([{ topic: "心理的安全性", isPrimarySource: false }]);
      await vi.waitFor(() => {
        if (spawnCalls.length < 1) throw new Error("not spawned yet");
      });
      const args = spawnCalls[0].args;
      expect(args[args.indexOf("--model") + 1]).toBe("gpt-5.2");
      emitResult(spawnCalls[0].child, '```url_lookup\n[{ "index": 1 }]\n```');
      await promise;
    });

    // API側（/api/settings/rules）で保存時に"auto"は拒否しているが、万一設定値に
    // "auto"が残っていた場合でもcursor-agentへ渡さず既定モデルへフォールバックする
    // defense-in-depthの回帰テスト。
    it("referenceLookupCursorModelが万一'auto'（大小文字・前後空白違い含む）でも既定モデルへフォールバックする", async () => {
      const settingsStore = await import("@core/settings-store");
      settingsStore.updateRulesAndConstraints({ cliOrder: ["cursor"], referenceLookupCursorModel: " Auto " });
      const rt = await loadModule();
      const promise = rt.findReferenceUrls([{ topic: "心理的安全性", isPrimarySource: false }]);
      await vi.waitFor(() => {
        if (spawnCalls.length < 1) throw new Error("not spawned yet");
      });
      const args = spawnCalls[0].args;
      expect(args[args.indexOf("--model") + 1]).toBe("gpt-5.2");
      emitResult(spawnCalls[0].child, '```url_lookup\n[{ "index": 1 }]\n```');
      await promise;
    });
  });

  it("claude CLIをWebSearch専用ツール・権限バイパスで起動する", async () => {
    const rt = await loadModule();
    const promise = rt.findReferenceUrls([{ topic: "心理的安全性", isPrimarySource: false }]);
    await vi.waitFor(() => {
      if (spawnCalls.length < 1) throw new Error("not spawned yet");
    });
    expect(spawnCalls[0].command).toBe("claude");
    const args = spawnCalls[0].args;
    expect(args).toContain("-p");
    expect(args[args.indexOf("--tools") + 1]).toBe("WebSearch");
    expect(args[args.indexOf("--permission-mode") + 1]).toBe("bypassPermissions");
    expect(args[args.indexOf("--output-format") + 1]).toBe("json");
    // プロンプトに組織固有の情報は無く、topic文字列のみが含まれる。
    expect(args[args.indexOf("-p") + 1]).toContain("心理的安全性");

    emitResult(spawnCalls[0].child, '```url_lookup\n[{ "index": 1, "url": "https://example.com/psych-safety" }]\n```');
    const results = await promise;
    expect(results).toEqual([{ topic: "心理的安全性", url: "https://example.com/psych-safety" }]);
  });

  // 実機検証で、「入力と同じトピック文字列を返せ」という指示にもかかわらずモデルが
  // プロンプト中の説明文まで含めた文字列を返すことがあると判明したため、topic文字列での
  // 突き合わせをやめ、プロンプトで明示した1始まりのindexで機械的に突き合わせる方式にした。
  // このテストはその回帰防止（モデルが多少揺れたtopic文字列を返しても、indexさえ合っていれば
  // 正しいトピックに紐付けられることを確認する）。
  it("モデルがtopicを厳密に一致させて返さなくても、indexで正しいトピックに紐付ける", async () => {
    const rt = await loadModule();
    const promise = rt.findReferenceUrls([{ topic: "心理的安全性", isPrimarySource: false }]);
    await vi.waitFor(() => {
      if (spawnCalls.length < 1) throw new Error("not spawned yet");
    });
    // モデルが（誤って）topicフィールドに説明文込みの文字列を含めてもindexだけで判定する。
    emitResult(
      spawnCalls[0].child,
      '```url_lookup\n[{ "index": 1, "topic": "「心理的安全性」（二次資料…）", "url": "https://example.com/psych-safety" }]\n```',
    );
    const results = await promise;
    expect(results).toEqual([{ topic: "心理的安全性", url: "https://example.com/psych-safety" }]);
  });

  it("url_lookupブロックのurlがhttp(s)以外なら破棄する", async () => {
    const rt = await loadModule();
    const promise = rt.findReferenceUrls([{ topic: "怪しいトピック", isPrimarySource: false }]);
    await vi.waitFor(() => {
      if (spawnCalls.length < 1) throw new Error("not spawned yet");
    });
    emitResult(spawnCalls[0].child, '```url_lookup\n[{ "index": 1, "url": "javascript:alert(1)" }]\n```');
    const results = await promise;
    expect(results).toEqual([{ topic: "怪しいトピック" }]);
  });

  it("indexが範囲外・不正な場合はその要素を無視する", async () => {
    const rt = await loadModule();
    const promise = rt.findReferenceUrls([{ topic: "何か", isPrimarySource: false }]);
    await vi.waitFor(() => {
      if (spawnCalls.length < 1) throw new Error("not spawned yet");
    });
    emitResult(
      spawnCalls[0].child,
      '```url_lookup\n[{ "index": 99, "url": "https://example.com/a" }, { "url": "https://example.com/b" }]\n```',
    );
    const results = await promise;
    expect(results).toEqual([]);
  });

  it("よく知られた有料学術ジャーナル/論文データベースのURLは破棄する", async () => {
    const rt = await loadModule();
    const promise = rt.findReferenceUrls([{ topic: "組織学習理論", isPrimarySource: true }]);
    await vi.waitFor(() => {
      if (spawnCalls.length < 1) throw new Error("not spawned yet");
    });
    emitResult(
      spawnCalls[0].child,
      '```url_lookup\n[{ "index": 1, "url": "https://www.sciencedirect.com/science/article/pii/xxx" }]\n```',
    );
    const results = await promise;
    expect(results).toEqual([{ topic: "組織学習理論" }]);
  });

  it("有料学術ジャーナルのサブドメインのURLも破棄する", async () => {
    const rt = await loadModule();
    const promise = rt.findReferenceUrls([{ topic: "何か", isPrimarySource: false }]);
    await vi.waitFor(() => {
      if (spawnCalls.length < 1) throw new Error("not spawned yet");
    });
    emitResult(spawnCalls[0].child, '```url_lookup\n[{ "index": 1, "url": "https://link.springer.com/article/xxx" }]\n```');
    const results = await promise;
    expect(results).toEqual([{ topic: "何か" }]);
  });

  it("有料学術ジャーナルに該当しないURLはそのまま採用する", async () => {
    const rt = await loadModule();
    const promise = rt.findReferenceUrls([{ topic: "心理的安全性", isPrimarySource: false }]);
    await vi.waitFor(() => {
      if (spawnCalls.length < 1) throw new Error("not spawned yet");
    });
    emitResult(
      spawnCalls[0].child,
      '```url_lookup\n[{ "index": 1, "url": "https://www.kaonavi.jp/dictionary/psychological-safety/" }]\n```',
    );
    const results = await promise;
    expect(results).toEqual([{ topic: "心理的安全性", url: "https://www.kaonavi.jp/dictionary/psychological-safety/" }]);
  });

  it("url_lookupブロックが無ければ空配列を返す", async () => {
    const rt = await loadModule();
    const promise = rt.findReferenceUrls([{ topic: "何か", isPrimarySource: false }]);
    await vi.waitFor(() => {
      if (spawnCalls.length < 1) throw new Error("not spawned yet");
    });
    emitResult(spawnCalls[0].child, "見つかりませんでした。");
    const results = await promise;
    expect(results).toEqual([]);
  });

  it("CLIプロセスがエラー終了しても例外を伝播させず空配列を返す", async () => {
    const rt = await loadModule();
    const promise = rt.findReferenceUrls([{ topic: "何か", isPrimarySource: false }]);
    await vi.waitFor(() => {
      if (spawnCalls.length < 1) throw new Error("not spawned yet");
    });
    spawnCalls[0].child.emit("error", new Error("起動失敗"));
    const results = await promise;
    expect(results).toEqual([]);
  });

  it("空文字だけのトピック配列はCLIを起動せず空配列を返す", async () => {
    const rt = await loadModule();
    const results = await rt.findReferenceUrls([{ topic: "   ", isPrimarySource: false }]);
    expect(results).toEqual([]);
    expect(spawnCalls).toHaveLength(0);
  });

  // ユーザー要望「Wikipediaの場合、日本語のページがないかチェックしてほしい」対応。
  describe("Wikipediaの日本語版チェック", () => {
    it("英語版WikipediaのURLで日本語版が存在する場合、日本語版のURLに差し替える", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          query: { pages: [{ langlinks: [{ lang: "ja", title: "心理的安全性" }] }] },
        }),
      });
      vi.stubGlobal("fetch", fetchMock);
      const rt = await loadModule();
      const promise = rt.findReferenceUrls([{ topic: "心理的安全性", isPrimarySource: false }]);
      await vi.waitFor(() => {
        if (spawnCalls.length < 1) throw new Error("not spawned yet");
      });
      emitResult(
        spawnCalls[0].child,
        '```url_lookup\n[{ "index": 1, "url": "https://en.wikipedia.org/wiki/Psychological_safety" }]\n```',
      );
      const results = await promise;
      expect(results).toEqual([{ topic: "心理的安全性", url: "https://ja.wikipedia.org/wiki/%E5%BF%83%E7%90%86%E7%9A%84%E5%AE%89%E5%85%A8%E6%80%A7" }]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toContain("en.wikipedia.org/w/api.php");
      expect(fetchMock.mock.calls[0][0]).toContain("Psychological_safety");
    });

    it("英語版WikipediaのURLで日本語版が存在しない場合、元のURLのまま使う", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ query: { pages: [{}] } }),
      });
      vi.stubGlobal("fetch", fetchMock);
      const rt = await loadModule();
      const promise = rt.findReferenceUrls([{ topic: "何か", isPrimarySource: false }]);
      await vi.waitFor(() => {
        if (spawnCalls.length < 1) throw new Error("not spawned yet");
      });
      emitResult(spawnCalls[0].child, '```url_lookup\n[{ "index": 1, "url": "https://en.wikipedia.org/wiki/Something" }]\n```');
      const results = await promise;
      expect(results).toEqual([{ topic: "何か", url: "https://en.wikipedia.org/wiki/Something" }]);
    });

    it("既に日本語版WikipediaのURLならAPIを呼ばずそのまま使う", async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      const rt = await loadModule();
      const promise = rt.findReferenceUrls([{ topic: "心理的安全性", isPrimarySource: false }]);
      await vi.waitFor(() => {
        if (spawnCalls.length < 1) throw new Error("not spawned yet");
      });
      emitResult(
        spawnCalls[0].child,
        '```url_lookup\n[{ "index": 1, "url": "https://ja.wikipedia.org/wiki/%E5%BF%83%E7%90%86%E7%9A%84%E5%AE%89%E5%85%A8%E6%80%A7" }]\n```',
      );
      const results = await promise;
      expect(results).toEqual([
        { topic: "心理的安全性", url: "https://ja.wikipedia.org/wiki/%E5%BF%83%E7%90%86%E7%9A%84%E5%AE%89%E5%85%A8%E6%80%A7" },
      ]);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("Wikipedia以外のURLならAPIを呼ばずそのまま使う", async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      const rt = await loadModule();
      const promise = rt.findReferenceUrls([{ topic: "心理的安全性", isPrimarySource: false }]);
      await vi.waitFor(() => {
        if (spawnCalls.length < 1) throw new Error("not spawned yet");
      });
      emitResult(
        spawnCalls[0].child,
        '```url_lookup\n[{ "index": 1, "url": "https://www.kaonavi.jp/dictionary/psychological-safety/" }]\n```',
      );
      const results = await promise;
      expect(results).toEqual([{ topic: "心理的安全性", url: "https://www.kaonavi.jp/dictionary/psychological-safety/" }]);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("Wikipedia言語間リンクAPIの呼び出しに失敗しても例外を伝播させず元のURLを使う", async () => {
      const fetchMock = vi.fn().mockRejectedValue(new Error("network error"));
      vi.stubGlobal("fetch", fetchMock);
      const rt = await loadModule();
      const promise = rt.findReferenceUrls([{ topic: "何か", isPrimarySource: false }]);
      await vi.waitFor(() => {
        if (spawnCalls.length < 1) throw new Error("not spawned yet");
      });
      emitResult(spawnCalls[0].child, '```url_lookup\n[{ "index": 1, "url": "https://en.wikipedia.org/wiki/Something" }]\n```');
      const results = await promise;
      expect(results).toEqual([{ topic: "何か", url: "https://en.wikipedia.org/wiki/Something" }]);
    });
  });

  it("複数トピックを1回のCLI呼び出しにまとめ、indexで正しい順に紐付ける", async () => {
    const rt = await loadModule();
    const promise = rt.findReferenceUrls([
      { topic: "コーチング", isPrimarySource: false },
      { topic: "Situational Leadership Theory", isPrimarySource: true },
    ]);
    await vi.waitFor(() => {
      if (spawnCalls.length < 1) throw new Error("not spawned yet");
    });
    expect(spawnCalls).toHaveLength(1);
    const prompt = spawnCalls[0].args[spawnCalls[0].args.indexOf("-p") + 1];
    expect(prompt).toContain("コーチング");
    expect(prompt).toContain("Situational Leadership Theory");

    // わざと逆順・一部欠落で返しても、indexだけで正しく元のトピックに紐付けられることを確認する。
    emitResult(spawnCalls[0].child, '```url_lookup\n[{ "index": 2, "url": "https://example.com/slt" }]\n```');
    const results = await promise;
    expect(results).toEqual([{ topic: "Situational Leadership Theory", url: "https://example.com/slt" }]);
  });
});

describe("findReferenceUrl", () => {
  it("該当トピックのurlを返す", async () => {
    const rt = await loadModule();
    const promise = rt.findReferenceUrl("心理的安全性");
    await vi.waitFor(() => {
      if (spawnCalls.length < 1) throw new Error("not spawned yet");
    });
    emitResult(spawnCalls[0].child, '```url_lookup\n[{ "index": 1, "url": "https://example.com/psych-safety" }]\n```');
    expect(await promise).toBe("https://example.com/psych-safety");
  });

  it("見つからなければundefinedを返す", async () => {
    const rt = await loadModule();
    const promise = rt.findReferenceUrl("見つからないトピック");
    await vi.waitFor(() => {
      if (spawnCalls.length < 1) throw new Error("not spawned yet");
    });
    emitResult(spawnCalls[0].child, '```url_lookup\n[{ "index": 1 }]\n```');
    expect(await promise).toBeUndefined();
  });
});
