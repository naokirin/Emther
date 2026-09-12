import { describe, expect, it } from "vitest";
import {
  buildImportPreview,
  detectSlackJsonl,
  normalizeChannelLabel,
  normalizeObservationInput,
  parseSlackJsonlLine,
  parseSlackTs,
  splitDelimitedLine,
} from "@/lib/observation-dump-normalize";

const SAMPLE = [
  ' {"ts":"1779701310.701429","channel":"スレッドの場所 :  test_channel","sender":"taro.tanaka","text":"ありがとうございますopenapi generatorに関して調査して何点か気がついたところがあるので、また明日共有させてください","permalink":"https://systemjp.slack.com/archives/XXXXXXXXXX/p1779701310701429?thread_ts=1779408841.980299","thread":{"skipped":true,"reason":"already_thread_reply"}}',
  ' {"ts":"1779677010.661189","channel":"スレッドの場所 :  test_channel_2","sender":"taro.tanaka","text":"どのユーザーを昇格しようとしたかログから追いづらいので改善考える","permalink":"https://systemjp.slack.com/archives/XXXXXXXXXX/p1779677010661189?thread_ts=1779620817.353679","thread":{"skipped":true,"reason":"already_thread_reply"}}',
  ' {"ts":"1779408841.980299","channel":"test_channel","sender":"taro.tanaka","text":"@ichiro.sato https://example.com/xxxxx このPBI取ってるんですが、\\"自動生成する際の設定値の決定\\"を進めてますもしテストやクライアント実装の設計など入れそうだったら進めていただいても大丈夫です  （編集済み）","permalink":"https://systemjp.slack.com/archives/XXXXXXXXXX/xxxxxxxxxxxxxxx?thread_ts=1779408841.980299","thread":{"skipped":true,"reason":"thread_pane_not_found"}}',
].join("\n");

describe("parseSlackTs", () => {
  it("Slack秒.小数をDateにする", () => {
    const d = parseSlackTs("1779408841.980299");
    expect(d).toBeInstanceOf(Date);
    expect(d!.getTime()).toBeCloseTo(1779408841.980299 * 1000, -1);
  });
});

describe("normalizeChannelLabel", () => {
  it("スレッドの場所プレフィックスを除く", () => {
    expect(normalizeChannelLabel("スレッドの場所 :  test_channel")).toBe("test_channel");
    expect(normalizeChannelLabel("test_channel")).toBe("test_channel");
  });
});

describe("Slack JSONL sample", () => {
  it("検出できる", () => {
    expect(detectSlackJsonl(SAMPLE)).toBe(true);
  });

  it("行をパースできる", () => {
    const msg = parseSlackJsonlLine(SAMPLE.split("\n")[0]);
    expect(msg?.sender).toBe("taro.tanaka");
    expect(msg?.channel).toBe("test_channel");
    expect(msg?.threadTs).toBe("1779408841.980299");
    expect(msg?.text).toContain("openapi generator");
  });

  it("時系列の平文に正規化し日付範囲を出す", () => {
    const result = normalizeObservationInput(SAMPLE);
    expect(result.detected).toBe(true);
    expect(result.messageCount).toBe(3);
    expect(result.text).toContain("#test_channel taro.tanaka");
    expect(result.text).toContain("#test_channel_2");
    expect(result.text.indexOf("このPBI")).toBeLessThan(result.text.indexOf("昇格"));
    expect(result.occurredRangeHint?.start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.occurredRangeHint?.end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.notes.some((n) => n.includes("JSONL"))).toBe(true);
  });

  it("通常テキストは検出しない", () => {
    const result = normalizeObservationInput("今日は1on1をした\nリリースが遅延");
    expect(result.detected).toBe(false);
    expect(result.text).toContain("1on1");
  });
});

describe("列マッピング付き正規化", () => {
  it("別名キーの JSONL をマッピングで平文化する", () => {
    const text = [
      '{"timestamp":"1779408841","user":"hana","message":"hello","room":"eng"}',
      '{"timestamp":"1779410000","user":"taro","message":"world","room":"eng"}',
    ].join("\n");
    const result = normalizeObservationInput(text, {
      syntax: "jsonl",
      fieldMapping: {
        timestamp: "ts",
        user: "sender",
        message: "text",
        room: "channel",
      },
      tsKind: "unix_seconds",
    });
    expect(result.detected).toBe(true);
    expect(result.messageCount).toBe(2);
    expect(result.text).toContain("#eng hana");
    expect(result.text).toContain("hello");
    expect(result.text).not.toContain('"timestamp"');
  });

  it("TSV + ヘッダマッピングで平文化する", () => {
    const text = [
      "time\tfrom\tbody",
      "1779408841\ttarou\t進捗共有します",
      "1779410000\thanako\t了解です",
    ].join("\n");
    const result = normalizeObservationInput(text, {
      syntax: "tsv",
      hasHeader: true,
      fieldMapping: { time: "ts", from: "sender", body: "text" },
      tsKind: "unix_seconds",
    });
    expect(result.detected).toBe(true);
    expect(result.messageCount).toBe(2);
    expect(result.text).toContain("tarou");
    expect(result.text).toContain("進捗共有します");
  });

  it("splitDelimitedLine はクォートを扱う", () => {
    expect(splitDelimitedLine('a\t"b\tc"\td', "\t")).toEqual(["a", "b\tc", "d"]);
  });
});

describe("buildImportPreview", () => {
  it("別名 JSONL の列と推奨マッピングを返す", () => {
    const text = '{"timestamp":"1","user":"a","message":"hi"}';
    const preview = buildImportPreview(text);
    expect(preview.suggestedSyntax).toBe("jsonl");
    expect(preview.columns).toEqual(expect.arrayContaining(["timestamp", "user", "message"]));
    expect(preview.suggestedMapping.message).toBe("text");
    expect(preview.suggestedMapping.user).toBe("sender");
  });
});
