# アーキテクチャ境界の見直し

作成日: 2026-09-23  
性質: **設計見直しの正本**（対象課題・フェーズ・成功条件）  
関連: `docs/philosophy.md` / `docs/archive/2nd_architecture.md` / `packages/api-contract/README.md`

---

## 0. 背景

第2世代への移行（Vite + Hono + `packages/core`）は完了している。当時切った境界は **「UI フレームワークからの隔離」** までであり、次は意図的に後回しにされていた内部設計を整える。

対象外（後回しでよいもの）:

- 相談経由の既存 Suggestion 整理（`docs/suggestion_organize_via_consult.md`）— アイデアレベルの追加機能
- OpenAPI（`@hono/zod-openapi`）の一括導入
- `people-directory` の独立パッケージ化、ストアごとの npm 分割
- 永続化ポート／アダプタの**一括**徹底（Phase D でパイロットから段階導入。ホットスポット一括書き換えはしない）

---

## 1. 対象課題

### 1.1 `packages/core` が境界のない巨大カーネル

- カテゴリ（persistence / ローカル ML / agent-runtime / ドメインストア / utility）は文書上あるが、コード上はほぼフラット
- `index.ts` は空で、公開面は `@emther/core/<file>` の deep import が正規経路
- ホットスポット: `types.ts`、`people-directory`、`agent-runtime/*`、`journal-store`、`knowledge-store`

目指すこと: core を小さくすることではなく、**「どこまでが何の責任か」がコード上で読める状態**にすること。

### 1.2 契約層が本線になっていない

- `api-contract` はあるが、ランタイム検証は journal / settings-rules 程度
- レスポンスは主に `satisfies`（コンパイル時のみ）
- 大きなエンティティは `.passthrough()`、Web は `rpcJsonAs<T>` 手付け
- `AgentRun` 等が core / contract / web ローカルで三系統化し、ドリフトし始めている

目指すこと: **新規・改修 API は契約を通す**運用。全ルートの一括厳密化はしない。

### 1.3 Web へのドメインロジック残存

- `daily-situation` / `today-state` / `dashboard-next-actions` など「状況判断・次の一手」が UI パッケージに残留
- `RunDetail.tsx` に `AgentRun` 等の型複製

目指すこと: **ドメイン判断の純関数は core、web は表示と配線だけ**。

---

## 2. 推奨フェーズ

```text
Phase A（型とドメイン判断の正本を揃える）
  → Phase B（契約を本線に寄せる）
  → Phase C（core 内部のフォルダ境界を明示）
```

各フェーズ完了時に `lint` / `typecheck` / `test` /（関連する）`build` が通ることを確認する。

### Phase A — 型一本化と dashboard ロジックの core 化

1. `AgentRun`（および Proposal / PeriodReview 等の関連型）を core 正本に一本化し、web のローカル複製を削除する
2. UI 非依存の run メタ判定（`isDraftAwaitingTriage` / `shouldOmitRunFromNextActions` / `runKindLabel` 等）を core へ移す（CSS 依存は web 残留）
3. `daily-situation` / `today-state` / `dashboard-next-actions` のデータ組み立てを core へ移す  
   - `onSelect` 等の UI コールバックは web 側で配線する

### Phase B — 契約層を本線に寄せる

1. `AgentRunView` 等を core 型に寄せ、ドリフト検知の土台を作る
2. JSON なのに未契約のルートをエンベロープ化する（バイナリ等は契約外と明示）
3. **新規・改修が入るルートから**リクエスト parse を横展開する
4. `z.infer` 系エンティティと core 型のドリフト検知テストを足す
5. passthrough 削減は小さい型から。Journal / Suggestion / Person は後回し
6. `web → server AppType` 依存・OpenAPI は本フェーズでは必須としない

### Phase C — core 内部のフォルダ境界を明示

1. 既存カテゴリをディレクトリに反映する（npm パッケージ分割はしない）
   - 例: `local-ml/`、`persistence/`、`observation-dump/`、`cloud-chat` → `agent-runtime/`
2. deep import パスは必要なら re-export で互換を維持する
3. `types.ts` は一度にバラさず、純ドメインの置き場方針を決める程度に留める

#### Phase C 完了時のフォルダ配置

```text
packages/core/src/
  local-ml/          # embeddings / local-model / mask-check / reranker / transformers-* 等
  persistence/       # persistence / db / state-archive
  observation-dump/  # observation-dump-*（index barrel あり）
  agent-runtime/     # 既存 + cloud-chat.ts
  types.ts           # ルート据え置き（下記ノート）
  *.ts               # 旧 deep import 互換 shim（export * from "./<dir>/..."）
```

旧パス `@emther/core/<file>` はルートの thin re-export shim で維持（`package.json` の `"./*": "./src/*.ts"` 前提）。
フォルダ外の core 内 import も shim 経由（`./embeddings` 等）にし、`vi.mock("@emther/core/embeddings")` が実装モジュールと同一 identity になるようにする。カテゴリ内でも、外部から mock されうる依存（例: `local-ml/mask-check` → `../local-model` / `../mask-check-morph`）は shim 経由にする。

**注意（ブラウザ）**: `@emther/core/agent-runtime`（`src/agent-runtime.ts`）は types / run-meta などクライアント安全な subset のみ。store / context-blocks / scheduled-tasks 等のフルバレルは `@emther/core/agent-runtime/index`（server 向け）。web がフルバレルを値 import すると embeddings → `node:fs` がクライアントに載る。

#### `types.ts` 配置ノート（分割しない）

- `types.ts` は **ルートに残す**（共有ドメイン型 + 純ヘルパーの置き場）
- これ以上の分割は見送り。`dashboard-*` / `daily-*` は既にルートのドメインユーティリティとして配置済み
- 目的は「境界がディレクトリで読めること」であり、型ファイルの細分化ではない

---

## 2.5 Phase D — 永続化ポート（DIP）

方針: **公開 deep import（`@emther/core/*-store`）は維持**し、内部だけ port／アダプタに分離する。DI コンテナや server composition root は導入しない（ファサードが既定アダプタを束ねる）。

```text
Phase D1（パイロット）glossary
  → Phase D2（類似 2〜3 本をコピーパターンで移行）
  → Phase D3（重複から共通 JSON アダプタを抽出）
```

### 境界ルール

| 層 | 知ってよい | 知ってはいけない |
|---|---|---|
| ドメイン | エンティティ型、バリデーション、並び順、コンテキスト文字列 | ファイル名、`loadJSON`、`EM_DATA_DIR`、SQL |
| アダプタ | ファイル名、atomic write、パス、空配列許可 | ドメイン固有の trim／ソート規則を増やしすぎない |
| ファサード（`*-store.ts`） | 既定アダプタの束ね、公開関数の re-export | — |

### 置き場

- ドメイン port / サービス: 例 `packages/core/src/glossary/`
- JSON アダプタ: `packages/core/src/persistence/adapters/`
- 公開面: ルートの `glossary-store.ts` 等（互換 shim）

### 意図的に後回し

`people-directory`、`knowledge-store`、`suggestion-store`、`journal-store`、`agent-runtime/store`（複雑・横断依存が大きい）。

---

## 3. 成功条件

1. ドメイン判断の純関数は `packages/core` にあり、web は表示と配線だけである
2. 同じ概念の型が実質1系統である（少なくとも `AgentRun`。View が必要なら contract が core をラップする）
3. 新規・改修 API は `api-contract` を通さずにマージしない運用ができている（全ルート厳密化は不要）
4. core 内で「ML / persistence / agent-runtime / stores」の置き場がディレクトリで読める（公開 API の厳選は任意）
5. （Phase D）ドメインモジュールが `loadJSON` / `saveJSON` / `getDb` 等の永続化具象を import せず、port 経由であること（パイロット対象から順次）

---

## 4. 進捗

| フェーズ | 状態 | 備考 |
|---|---|---|
| Phase A | 完了 | AgentRun 型を `@emther/core/agent-runtime` に一本化。run meta（`runFallbackTitle` / `runKindLabel` / `shouldOmitRunFromNextActions` / `isDraftAwaitingTriage` / `draftKindLabel`）を core へ。`daily-situation` / `today-state` / `dashboard-next-actions` を core 化し、NextAction/SituationItem は `target` を持ち web で `attach*Handlers` により onSelect 配線。STATUS_META と React コンポーネントは web 残留。`packages/core/src/agent-runtime.ts` は **ブラウザ安全な subset のみ**（types / run-meta）。サーバー用フルバレルは `@emther/core/agent-runtime/index`。 |
| Phase B | 完了 | `AgentRunView`＝core `AgentRun`。id-resolve / mask-check / models-status を api-contract エンベロープ化（`satisfies`）。teams POST に寛容リクエスト parse。`core-type-drift.test.ts` で Team〜AgentRun 等の型一致を検知。settings/data/backup はバイナリのため契約外と README 明記。 |
| Phase C | 完了 | `local-ml/`・`persistence/`・`observation-dump/` を新設。`cloud-chat` → `agent-runtime/`。旧 deep import はルート shim で互換維持。`types.ts` はルート据え置き（分割見送り）。 |
| Phase D | 完了（D1–D3） | D1: glossary を port／アダプタ分離。D2: em-growth / policies / settings を同パターンで移行。D3: `persistence/json-document.ts` に `createJsonArrayDocument` / `createJsonSingletonDocument` を抽出（ドメイン port は固有のまま）。公開 `*-store` deep import は維持。 |
