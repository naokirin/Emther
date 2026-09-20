// docs/2nd_architecture/plan.md フェーズ4.10: eslint-config-next に依存しない
// ルート設定。@emther/core・@emther/server・@emther/web を対象とする。
import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/node_modules/**"],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    // 全角スペース（U+3000）はUI文言・コメントで日本語の視覚的区切りとして
    // 意図的に使うため、no-irregular-whitespaceの誤検知を避けるためオフにする。
    rules: {
      "no-irregular-whitespace": "off",
    },
  },
  {
    files: ["packages/core/src/**/*.ts", "apps/server/src/**/*.ts"],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ["apps/web/src/**/*.{ts,tsx}"],
    languageOptions: {
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
    },
  },
);
