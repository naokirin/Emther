import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// RTLの自動クリーンアップはglobalThis.afterEachの有無を見て自己登録する仕組みだが、
// このプロジェクトはtest.globals:trueを使わず`vitest`から明示importしているため
// 自動検出されない。ここで明示的に登録し、テストごとにレンダー済みDOMを破棄する
// （でないと後続テストのgetByRole等が前のテストの要素と衝突する）。
afterEach(() => {
  cleanup();
});
