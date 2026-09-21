# Goal / Policy / Theme 実装方針・計画

作成日: 2026-09-20　最終更新: 2026-09-21（Phase 1〜4 実装完了）
関連: `docs/goal_policy_model.md`（方針・設計思想の正本） / `docs/philosophy.md` / `docs/archive/value_hierarchy_and_flow.md` / `docs/knowledge_distillation.md`

**状態: Phase 1〜4 完了。** Policy新設・Goal新設（Objective/Themeへの任意リンク＋AI紐づけ提案）・Goal起点テーマ生成・ドキュメント更新まで実装済み。以下は実装計画（着手前に書いたもの）だが、実装後もアーキテクチャの正本として残す。

このドキュメントは `docs/goal_policy_model.md` の方針を、現行実装にどう落とし込むかの計画である。設計思想そのものは `goal_policy_model.md` を正本とし、ここでは「今の何を」「どう変えるか」だけを扱う。

---

## 0. 現状把握（既存実装との対応）

| goal_policy_model.md の概念 | 現状の実装 | ギャップ |
|---|---|---|
| MVV | `OrgStrategy`（mission/vision/values、`org-context-store/strategy.ts`） | なし。そのまま維持でよい |
| Goal | `Objective`/`KeyResult`（`org-context-store/objectives.ts`）。`keyResults` は既に空配列を許容し、`note` で定性的記述も可能 | OKRの構造をそのまま流用すると、Goal本来の「OKRを使わなくてよい」性質が伝わりにくい（§1 Decision 1） |
| Policy | **存在しない** | 新設が必要 |
| Theme | `OrgTheme`（`theme-store.ts`）。生成起点は週次蒸留（観測→テーマ候補）一本 | Goal起点で先にテーマを立てる経路がない（`value_hierarchy_and_flow.md` §2.3で既に指摘済みの課題と同根） |

`/org`（`OrgPage.tsx`）は既にページタイトルが「方針・目標」で、左ツリーに Strategy / Standing Background / Objectives / Themes / Glossary を持つ構成。GoalとPolicyもここに並ぶ区分として自然に収まる。

---

## 1. 基本方針（ユーザー確定済み）

### Decision 1: Goalは新規エンティティとして独立させる（Objectiveの拡張はしない）

ユーザー判断: 「既存OKRのモデルを踏襲すると、データモデルの管理の煩雑さや内部保持データがシステム的にもユーザー的にもわかりにくくなる。既存データ移行は考えなくて良いが、これまでのような『AIによる紐づけ提案』をGoalエンティティでも利用できるようにする」

- **新設**: `Goal` を `Objective` とは別の型・別ストアとして新設する。既存 `Objective`/`OrgTheme` データの移行処理は行わない。
- **想定型**（`Goal`）:
  ```ts
  type Goal = {
    id: string;
    title: string;
    note?: string;
    // Objectiveと同じカスケーディング（未指定＝組織全体、指定時はそのチーム自身のGoal）
    teamId?: string;
    // 「遠い/中間/近い」等、異なる時間軸を持ってよい（goal_policy_model.md §2 Goal）。
    // 必須ではない任意ヒント。
    horizon?: "long" | "mid" | "near";
    status: "active" | "achieved" | "abandoned";
    createdAt: number;
    updatedAt: number;
  };
  ```
- **Objectiveとの関係**: `Objective`（OKR）に任意の `goalId?: string` を追加する。「あるGoalをOKRとして具体化する」ときだけ紐付ける。未設定＝OKRを使わないGoal、または（既存データのように）Goal非紐付けのOKR。
- **Themeとの関係**: `OrgTheme` に `goalIds?: string[]` を追加する。既存の `objectiveIds`/`keyResultIds` はOKRレベルの細かいリンクとしてそのまま残す（ThemeはGoal直下・OKR経由のどちらでもリンクできる）。
- **AIによる紐づけ提案**: 既存の `POST /api/themes/link/suggest`（`themes-link-suggest.ts`、`ThemeOkrLinkSuggestion`）と同じパターンで、Goalへの紐づけもAI提案できるようにする（§3 Phase 2）。

### Decision 2: Policyは新規ストアとして追加する。固定欄ではなく「複数件持てる自由記述リスト」とする

ユーザー判断: 「自由記述の複数エントリ」で確定。

- **理由**: 「大切にすること／優先すること／やらないこと／判断原則」は `goal_policy_model.md` 内でも例示であり必須構造ではない。固定欄にすると「欄を埋めるための入力」になり、方針4「入力項目を埋めることを目的にしない」に反する。`OrgBackgroundEntry` に近い、1件ずつ追加できる自由記述リストが実装・思想の両面で整合する。
- **想定型**（`PolicyEntry`）:
  ```ts
  type PolicyEntry = {
    id: string;
    text: string;
    // ヒント用の任意カテゴリ。必須ではない（未設定可）。
    category?: "value" | "priority" | "avoid" | "principle" | "other";
    createdAt: number;
    updatedAt: number;
    archivedAt?: number;
  };
  ```
- **永続化**: `policies.json`。自由記述に人名が混ざりうるため他エンティティ同様 `maskForStorage`/`unmaskNames` を通す。
- **Agent注入**: `buildPolicyContextBlock()` を新設し、MVV/Goal/Themeと並ぶ「絶対の前提」ブロックとして常時注入する。

### Decision 3: Themeの生成起点をGoal起点にも開く

- **理由**: 現状は「観測からの後追いテーマ生成」しか経路がない（`value_hierarchy_and_flow.md` §2.3で指摘済み）。goal_policy_model.md の方針（MVV → Goal/Policy/Theme → 日々の観測・判断）に沿って、Goalから先にテーマを立てる経路を追加する。
- **追加**: Goal詳細から「このGoalに向けた重点テーマ候補を出す」を手動起動できるようにする。既存の週次蒸留（観測→テーマ修正）はそのまま「先出しテーマを実態で修正する」役割として残す（廃止ではなく役割分担の明確化）。

---

## 2. スコープ外・変えないもの

- `Issue`/`Suggestion` の `themeId`/`keyResultId` 構造は変えない（Issueの紐づけ先はThemeとKeyResultのまま、Goalへは直接紐付けない）。
- メンバー・チーム評価（`value_hierarchy_and_flow.md` §5、A/B評価ログ）は別スコープ。本計画では触れない。
- 週次蒸留（観測→テーマ修正）の仕組み自体は維持。役割を「Goal起点で先出ししたテーマの修正機構」として明確化するのみ。
- 既存 `Objective`/`OrgTheme` データの移行処理は行わない（`goalId`/`goalIds` は任意フィールドとして追加するだけで、既存データは無変更のまま動作する）。

---

## 3. 実装計画（フェーズ、Phase 1〜3を一続きで進める）

### Phase 1: Policy MVP

- `packages/core`: `types.ts` に `PolicyEntry` 型、`org-context-store/policies.ts` ストア新設（CRUD、`maskForStorage`/`unmaskNames`）
- `apps/server`: `routes/policies.ts`（GET/POST/PATCH/DELETE）
- `apps/web`: `PolicyPanel.tsx`（`StrategyPanel`/`StandingBackgroundPanel` に準じたUI）、`OrgLeftTree` にPolicy項目追加、`OrgPage.tsx` に `selection.kind: "policy"` 追加
- `packages/core/agent-runtime/context-blocks.ts`: `buildPolicyContextBlock()` 追加、`buildSystemPrompt` に注入
- Glossary/Help更新

### Phase 2: Goal新設 + AIによる紐づけ提案

- `packages/core`: `types.ts` に `Goal` 型、`org-context-store/goals.ts` ストア新設（CRUD、`objectives.ts` と同じ命名・マスク規約）
- `Objective` 型に `goalId?: string` を追加。`OrgTheme` 型に `goalIds?: string[]` を追加
- `apps/server`: `routes/goals.ts`（GET/POST/PATCH/DELETE）
- **AI紐づけ提案**:
  - 既存 `themes-link-suggest.ts`（`POST /api/themes/link/suggest`）を拡張し、`goalIds`/`labels.goals` も提案対象に含める
  - 新規 `POST /api/objectives/link/suggest`（または `goals` 配下）: 既存Objective(OKR)がどのGoalを実現しているかをAIが提案する。既存の `org-objectives-parse.ts` と同じAgent呼び出しパターンを踏襲
- `apps/web`: `GoalsPanel.tsx`（`ObjectivesPanel.tsx` を参考に新設）、Objective編集画面・Theme編集画面（`ThemeOkrLinkEditor.tsx` 等）にGoal紐づけUI（AI提案の確認・採用込み）を追加
- `context-blocks.ts`: `buildGoalsContextBlock()` を新設し、MVVの直下・Objectiveの上位情報としてAgentへ常時注入。`buildObjectivesBlock`/`buildThemesContextBlock` の文言もGoalとの関係が伝わるよう更新

### Phase 3: Theme生成をGoal起点にも開く

- サーバー: 対象GoalIdを渡してテーマ候補を生成する経路を追加（既存 `themes.ts` の distill エンドポイント、または新規origin）
- UI: Goal詳細（`GoalsPanel`）に「このGoalのテーマ候補を出す」ボタンを追加 → 生成された候補は既存の `OrgThemesPanel` 採用フローに合流

### Phase 4: ドキュメント・ヘルプ更新

- `docs/philosophy.md` §6「主要概念」にGoal/Policyの節を追加
- `HelpPage.tsx`/`glossary-store.ts` にGoal/Policy用語追加
- `docs/goal_policy_model.md` は正本として維持し、本計画docからリンクする
