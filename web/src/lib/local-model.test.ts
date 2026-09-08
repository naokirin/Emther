import { describe, expect, it } from "vitest";
import { extractFirstJsonObject } from "@/lib/local-model";

describe("extractFirstJsonObject", () => {
  it("素直なJSONオブジェクトを抽出する", () => {
    expect(extractFirstJsonObject('{"a":1}')).toBe('{"a":1}');
  });

  it("前後に余計なテキストがあっても最初の釣り合いの取れたオブジェクトを抽出する", () => {
    const text = 'ここから説明文です {"tags":["a"],"people":[]} という結果です。';
    expect(extractFirstJsonObject(text)).toBe('{"tags":["a"],"people":[]}');
  });

  it("ネストしたオブジェクトも深さのバランスを取って抽出する", () => {
    const text = '{"outer":{"inner":1}} 余計な後続テキスト {"second":true}';
    expect(extractFirstJsonObject(text)).toBe('{"outer":{"inner":1}}');
  });

  it("小型モデルがJSON出力後も生成を続けた場合、最初のオブジェクトだけを取り出す", () => {
    const text = '{"a":1}{"a":2}{"a":3}';
    expect(extractFirstJsonObject(text)).toBe('{"a":1}');
  });

  it("{が無ければundefinedを返す", () => {
    expect(extractFirstJsonObject("説明文のみでJSONなし")).toBeUndefined();
  });

  it("開き括弧に対応する閉じ括弧が無ければundefinedを返す", () => {
    expect(extractFirstJsonObject('{"a":1')).toBeUndefined();
  });
});
