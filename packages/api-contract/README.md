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

## ミューテーション（POST / PATCH / DELETE）レスポンス

GET と同じ方針で、成功時の JSON ボディはサーバーで `satisfies XxxResponse`、web は `rpcData<XxxResponse & { error?: string }>` 等で契約型に揃える。エラーボディ（`{ error: string }`）自体は対象外。

| Response 型 | 主なエンドポイント |
| --- | --- |
| `OkResponse`（`{ ok: true }`） | 各種 `DELETE`（`teams/:id`, `people/:id`, `goals/:id`, `policies/:id`, `org/background/:id` 等） |
| `TeamMutationResponse` | `POST /api/teams`, `PATCH /api/teams/:id`, `POST /api/teams/:id/archive` |
| `TeamsBulkMutationResponse` | `POST /api/teams/bulk` |
| `EmCheckinMutationResponse` | `POST /api/em-self/checkins` |
| `ReflectionNoteMutationResponse` | `POST` / `PATCH /api/em-self/reflection-notes` |
| `JournalCreateResponse` | `POST /api/journal` |
| `JournalBulkResponse` | `POST /api/journal/bulk` |
| `JournalEntryResponse` | `PATCH /api/journal/:id`, archive/no-action-needed 系 |
| `JournalAnalyzeResponse` | `POST /api/journal/:id/analyze` |
| `JournalLocalSummarizeResponse` | `POST /api/journal/local-summarize` |
| `AgentRunMutationResponse` | `POST /api/journal/batch`, `/api/growth/generate`, `/api/themes/distill`, `/api/agents`, `/api/agents/:id/decide`, `/api/agents/pending-unmasked`（確定時） |
| `PendingUnmaskedResponse` | 上記と同エンドポイントの 202（人名未確認で保留） |
| `SuggestionMutationResponse` | `POST /api/suggestions`, `PATCH /api/suggestions/:id`, `/api/suggestions/:id/memo` |
| `SuggestionsLinkSuggestResponse` | `POST /api/suggestions/link/suggest` |
| `AgentThemesAdoptResponse` | `POST /api/agents/:id/themes` |
| `AgentSuggestionUpdatesResponse` | `POST /api/agents/:id/suggestion-updates` |
| `AgentSuggestionNotesResponse` | `POST /api/agents/:id/suggestion-notes` |
| `GrowSuggestionMutationResponse` | `PATCH /api/growth/suggestions/:id` |
| `PersonMutationResponse` | `POST /api/people`, `POST /api/people/:id/merge` |
| `PersonConcernAckResponse` | `PATCH /api/people/:id/concern-acks/:suggestionId`（ack=true） |
| `PersonEvaluationLogsResponse` | `POST /api/people/:id/evaluation-logs`（suggest-from-journal） |
| `PersonEvaluationLogMutationResponse` | `PATCH /api/people/:id/evaluation-logs/:logId` |
| `GoalMutationResponse` | `POST /api/org/goals`, `PATCH /api/org/goals/:id` |
| `PolicyMutationResponse` | `POST /api/org/policies`, `PATCH /api/org/policies/:id` |
| `OrgBackgroundMutationResponse` | `POST /api/org/background`, `PATCH /api/org/background/:id` |
| `ThemeMutationResponse` | `POST /api/themes`, `PATCH /api/themes/:id`（adopt/dismiss/revise/link） |
| `ThemesFromGoalResponse` | `POST /api/themes/from-goal` |
| `ThemeGoalLinkSuggestResponse` | `POST /api/themes/link/suggest-goal` |
| `ReportMutationResponse` | `POST /api/reports`, `PATCH /api/reports/:id` |
| `ReportReviewResponse` | `POST /api/reports/review` |
| `DataMutationResponse` | `POST /api/settings/data/reset`, `/api/settings/data/restore` |
| `KnowledgeInterpretationMutationResponse` | `POST /api/knowledge/interpretations` |
| `ObservationDumpMutationResponse` | `POST /api/journal/dumps`, `PATCH /api/journal/dumps/:id`, `POST /api/journal/dumps/:id/parse` |
| `ObservationDumpPreviewResponse` | `POST /api/journal/dumps/preview` |
| `ObservationDumpAcceptResponse` | `POST /api/journal/dumps/:id/accept` |
| `ImportProfileMutationResponse` | `POST /api/journal/dumps/profiles` |
| `GlossaryEntryMutationResponse` | `POST /api/glossary`, `PATCH /api/glossary/:id` |

横展開するときは新規・改修ルートからスキーマをここに追加し、サーバーで `satisfies`、web の `rpcJsonAs` を契約型に置換する。
