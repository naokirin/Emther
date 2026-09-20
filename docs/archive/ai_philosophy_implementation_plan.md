# 哲学レンズ 実装計画・実装記録

作成日: 2026-09-20
関連文書: `docs/ai_ philosophy.md`（方針） / `docs/3rd_pivot_version/pivot.md`（Expand/Challengeの原型、実体は`docs/4th_pivot/`） / `docs/agent_specialization.md`（役割差分化）
対象コード: `packages/core/src/agent-runtime/philosophy-lenses.ts` / `packages/core/src/agent-runtime/context-blocks.ts` / `packages/core/src/agent-runtime/agent-catalog.ts` / `packages/core/src/agent-runtime/batch-context-blocks.ts` / `packages/core/src/agent-runtime/scheduled-tasks.ts` / `packages/core/src/agent-runtime/types.ts` / `packages/core/src/agent-runtime/extraction.ts` / `apps/web/src/components/run-detail/ProposalBlock.tsx` / `apps/web/src/components/RunDetail.tsx`

---

## 1. 背景

`docs/ai_ philosophy.md` は、EmtherのAIが「EM自身の問題認識をなぞるだけ」になりがちな課題に対し、Agile / Scrum・Empiricism / Lean / DORA・Capability / Design Thinking / Systems Thinking という6つの**哲学レンズ**を持たせ、状況に応じて選択的に適用することで、EMが見ていなかった視点を発見させる、という方針を掲げている。

実装前の状態として、`buildSystemPrompt` には既に `Observe → Remember → Interpret → Expand → Challenge → Suggest` という分析順序があった（`docs/3rd_pivot_version/pivot.md` 由来）が、「どの視点から見るか」というレンズそのものは定義されておらず、`ai_ philosophy.md` が提案する `Lens Selection` / `Hypothesis` ステップも未実装だった。

## 2. 実装内容

### 2.1 哲学レンズカタログの新設

`packages/core/src/agent-runtime/philosophy-lenses.ts` に `PHILOSOPHY_LENSES`（6レンズ）と `LENS_USAGE_GUIDANCE`（使い方の手順）を定義。要約による圧縮を避け、各レンズが体現する哲学・問い方・具体例（DORAの因果連鎖、Systems Thinkingのリリース遅延連鎖など）を`docs/ai_ philosophy.md`から落とさずに反映している。

`LENS_USAGE_GUIDANCE` は「1〜3個選ぶ」のような個数のノルマを置かない。状況に有効なレンズだけを、有効な数だけ使うという `ai_ philosophy.md`「レンズの使い方」の考え方をそのまま踏襲している。

### 2.2 分析順序の拡張

`context-blocks.ts` の `buildSystemPrompt` に、哲学レンズカタログ全文と使い方の指示を注入したうえで、分析順序を

```
Observe → Remember → Interpret → Lens Selection → Expand → Challenge → Hypothesis → Suggest
```

に拡張した。Lens Selectionでレンズを選び、それを使ってExpand/Challengeを行い、Hypothesisで（断定できない場合は仮説のまま）結論を形づくる、という運びを明文化している。

この`base`ブロックはLead/専門Agentの全runで共通に使われるため、対話的な相談だけでなく、朝サマリー・週次/月次レポート・蒸留・Journal自動分析など、すべての自律実行エントリポイントに自動的に及ぶ。

### 2.3 proposalスキーマへの `lensesUsed`（任意）追加

`types.ts` の `Proposal` 型に `lensesUsed?: { lens: string; insight: string }[]` を追加（`apps/web/src/components/RunDetail.tsx` 側の同型定義にも反映）。`extraction.ts` の `extractProposal` は `normalizeLensUsage` で壊れにくくパースし、不正な要素は黙って除外する。必須フィールドではなく、旧runとの後方互換を保つ。

### 2.4 UIへの軽量な可視化

`ProposalBlock.tsx` の既存の折りたたみ（「🔍 AIの思考プロセス・判断根拠を確認する」）内、Expand/Challengeの直後に「🧭 使用した哲学レンズ」を追加。4th pivotの「結論ファースト・思考過程は折りたたみ」方針は崩していない。

### 2.5 役割定義・重複リマインダーの更新

`agent-catalog.ts` の `ROLE_BLOCKS` に、各専門Agentの「効きやすい哲学レンズ」を参考情報として1行追加（People: Systems Thinking / Design Thinking、Process: Lean、Tech: DORA / Capability、Product: Agile / Lean）。強制ではなく判断の出発点であり、他レンズの使用を妨げない旨を明記している。

`batch-context-blocks.ts`（Journal集約解釈）・`scheduled-tasks.ts`（手動Journal分析）にある、Expand/Challengeを重ねて念押しする短い文言にも、Lens Selectionへの言及を追記した。

## 3. 既知のギャップ（未対応・今回スコープ外）

- `lensesUsed` は Agent Run の `Proposal`（対話パネル）にのみ存在する。相談結果を提案（Suggestion/Issue）として採用した際、`expansions` / `challenges` / `advice` 等は `SuggestionDetail`（`packages/core/src/suggestion-store.ts` / `types.ts`）へコピーされ、`SuggestionDetailContent.tsx` で確認できるが、`lensesUsed` はこの永続化経路に含めていない。相談画面を離れると「どのレンズを使ったか」の記録が失われる。
  - 必要になった場合は、`SuggestionDetailInput` / `SuggestionDetail` 型と `suggestion-store.ts` の該当関数（`expansions`/`challenges`と同じ扱い箇所）、`apps/server/src/routes/issues.ts` / `suggestions.ts`、`SuggestionDetailContent.tsx` に同様の追加が必要。

## 4. 検証

- `npm run lint`: エラー0（既存warning 28件は本変更と無関係）
- `packages/core` Vitest: 758件全通過（`agent-runtime.test.ts` に哲学レンズ・`lensesUsed`関連テストを追加）
- `apps/web` Vitest: 413件全通過
- `apps/web` `tsc --noEmit`: エラーなし
