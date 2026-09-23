# @emther/api-contract

Hono API の入出力 Zod スキーマ（共有契約層）。

## 方針

- **置き場**: スキーマはここ。ドメインロジックは `@emther/core`。
- **クライアント接続**: `apps/web` は Hono RPC（`hc<AppType>`）。`AppType` は `@emther/server/app`。
- **OpenAPI**（`@hono/zod-openapi`）: 後追い。スキーマさえあれば追加しやすい。
- **検証の厳しさ**
  - `journal` / `settings/rules` のリクエスト: **寛容**（不正型 → 未指定）。既存テスト・UX で固定。
  - GET レスポンス: **厳密な HTTP エンベロープ**（`{ checkins }` / `{ teams }` 等）。サーバーは `satisfies XxxResponse`、web は `rpcJsonAs<XxxResponse>`。
  - 大きなドメインエンティティ（Journal / Suggestion / Rules / PersonProfile / AgentRun 等）は必須フィールドを列挙し、深い optional は `.passthrough()`。小さい型はフィールドをフル定義。

## 構成

| パス | 内容 |
| --- | --- |
| `health` / `timeline` | 既存 GET レスポンス |
| `journal` / `settings-rules` | POST / PATCH リクエスト body（寛容） |
| `entities/*` | 共有エンティティスキーマ |
| `responses/*` | ポーリング GET のレスポンスエンベロープ |

## GET レスポンス（`queries.ts` ポーリング対応）

| Response 型 | エンドポイント |
| --- | --- |
| `TimelineResponse` | `GET /api/timeline` |
| `EmCheckinsResponse` | `GET /api/em-self/checkins` |
| `ReflectionNotesResponse` | `GET /api/em-self/reflection-notes` |
| `TeamsResponse` | `GET /api/teams` |
| `JournalListResponse` | `GET /api/journal` |
| `JournalSearchResponse` | `GET /api/journal/search` |
| `JournalBatchStatusResponse` | `GET /api/journal/batch` |
| `JournalEntryResponse` | `GET /api/journal/:id` |
| `SettingsRulesResponse` | `GET /api/settings/rules` |
| `PeopleResponse` | `GET /api/people` |
| `PersonProfileResponse` | `GET /api/people/:id` |
| `PersonEvaluationLogsResponse` | `GET /api/people/:id/evaluation-logs` |
| `GoalsResponse` | `GET /api/org/goals` |
| `OrgBackgroundsResponse` | `GET /api/org/background` |
| `OrgStrategyResponse` | `GET /api/org/strategy` |
| `PoliciesResponse` | `GET /api/org/policies` |
| `ThemesResponse` | `GET /api/themes` |
| `ReportsResponse` | `GET /api/reports` |
| `GrowSuggestionsResponse` | `GET /api/growth/suggestions` |
| `AgentsResponse` | `GET /api/agents` |
| `AgentsInboxResponse` | `GET /api/agents/inbox` |
| `VitalsResponse` | `GET /api/vitals`（エンベロープ無し = OrgVitals） |
| `SuggestionsResponse` | `GET /api/suggestions` |
| `SuggestionDetailResponse` | `GET /api/suggestions/:id` |
| `KnowledgeEventsResponse` | `GET /api/knowledge/events` |

`AgentRunView`（`entities/agents.ts`）は `toRunView` が返す run ビューの必須フィールド＋passthrough。

横展開するときは新規・改修ルートからスキーマをここに追加し、サーバーで `satisfies`、web の `rpcJsonAs` を契約型に置換する。
