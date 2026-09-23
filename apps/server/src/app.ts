import { Hono } from "hono";
import { honoErrorHandler } from "./lib/error-handling";
import { mountStaticClient } from "./lib/static-client";
import { healthRoute } from "./routes/health";
import { glossaryRoute } from "./routes/glossary";
import { vitalsRoute } from "./routes/vitals";
import { timelineRoute } from "./routes/timeline";
import { idResolveRoute } from "./routes/id-resolve";
import { knowledgeEventsRoute } from "./routes/knowledge-events";
import { teamsRoute } from "./routes/teams";
import { orgBackgroundRoute } from "./routes/org-background";
import { orgPoliciesRoute } from "./routes/org-policies";
import { goalsRoute } from "./routes/goals";
import { themeGoalLinkSuggestRoute } from "./routes/goal-link-suggest";
import { reportsRoute } from "./routes/reports";
import { growthSuggestionsRoute } from "./routes/growth-suggestions";
import { checkinsRoute, reflectionNotesRoute } from "./routes/em-self";
import { peopleRoute } from "./routes/people";
import { orgStrategyRoute } from "./routes/org-strategy";
import { journalRoute } from "./routes/journal";
import { settingsRulesRoute } from "./routes/settings-rules";
import { themesRoute } from "./routes/themes";
import { agentsRoute, agentsInboxRoute, agentsPendingUnmaskedRoute } from "./routes/agents";
import { suggestionsRoute } from "./routes/suggestions";
import { themesDistillRoute } from "./routes/themes-distill";
import { growthGenerateRoute } from "./routes/growth-generate";
import { modelsStatusRoute } from "./routes/models-status";
import { maskCheckRoute } from "./routes/mask-check";
import { journalLocalSummarizeRoute } from "./routes/journal-local-summarize";
import { knowledgeInterpretationsRoute } from "./routes/knowledge-interpretations";
import { settingsDataBackupRoute } from "./routes/settings-data-backup";
import { settingsDataResetRoute } from "./routes/settings-data-reset";
import { settingsDataRestoreRoute } from "./routes/settings-data-restore";
import { journalDumpsRoute } from "./routes/journal-dumps";
import { suggestionsLinkSuggestRoute } from "./routes/suggestions-link-suggest";

// docs/2nd_architecture/plan.md フェーズ2: apps/server 骨組み。
// ルート追加のたびに、対応する web/src/app/api/**/route.ts を
// web/src/lib/hono-proxy.ts 経由のフォワードへ置き換える（並走運用）。
// docs/2nd_architecture/plan.md フェーズ4.3: clientDir を渡すと `dist/client`
// の静的配信 + SPA フォールバックを同一プロセスで有効化する（省略時は API のみ。
// テスト・dev（vite dev が別プロセスで配信）はこれまで通り省略で動く）。
//
// API ルートはチェーンで組み立て、Hono RPC（hc<AppType>）用の AppType を export する。
// 注意: Honoは別々にmountされたサブアプリ同士でパスが重なる場合、静的パスを
// 優先せず「先にmountされた方」が勝つ（単一Honoインスタンス内でのstatic-vs-:id
// 優先とは挙動が異なる）。そのため、あるprefix配下のサブパスを別ファイルへ切り出す
// ときは、親（:idワイルドカードを持つ）より必ず先にmountすること
// （実例: /api/journal/dumps が /api/journal の GET /:id に飲まれていた不具合。
// docs/2nd_architecture/plan.md フェーズ2.5 高リスク バッチ9参照）。
function createApiApp() {
  return new Hono()
    .route("/api/health", healthRoute)
    .route("/api/glossary", glossaryRoute)
    .route("/api/vitals", vitalsRoute)
    .route("/api/timeline", timelineRoute)
    .route("/api/id-resolve", idResolveRoute)
    .route("/api/knowledge/events", knowledgeEventsRoute)
    .route("/api/teams", teamsRoute)
    .route("/api/org/background", orgBackgroundRoute)
    .route("/api/org/policies", orgPoliciesRoute)
    .route("/api/org/goals", goalsRoute)
    .route("/api/reports", reportsRoute)
    .route("/api/growth/suggestions", growthSuggestionsRoute)
    .route("/api/em-self/checkins", checkinsRoute)
    .route("/api/em-self/reflection-notes", reflectionNotesRoute)
    .route("/api/people", peopleRoute)
    .route("/api/org/strategy", orgStrategyRoute)
    .route("/api/journal/local-summarize", journalLocalSummarizeRoute)
    .route("/api/journal/dumps", journalDumpsRoute)
    .route("/api/journal", journalRoute)
    .route("/api/settings/rules", settingsRulesRoute)
    .route("/api/themes/distill", themesDistillRoute)
    .route("/api/themes/link/suggest-goal", themeGoalLinkSuggestRoute)
    .route("/api/themes", themesRoute)
    .route("/api/agents/inbox", agentsInboxRoute)
    .route("/api/agents/pending-unmasked", agentsPendingUnmaskedRoute)
    .route("/api/agents", agentsRoute)
    .route("/api/suggestions/link/suggest", suggestionsLinkSuggestRoute)
    .route("/api/suggestions", suggestionsRoute)
    .route("/api/growth/generate", growthGenerateRoute)
    .route("/api/models/status", modelsStatusRoute)
    .route("/api/mask-check", maskCheckRoute)
    .route("/api/knowledge/interpretations", knowledgeInterpretationsRoute)
    .route("/api/settings/data/backup", settingsDataBackupRoute)
    // docs/2nd_architecture/plan.md フェーズ4.3a: 単一プロセス配信化により
    // scheduleProcessExit()（process.exit）を呼んでも問題ないため移植。
    .route("/api/settings/data/reset", settingsDataResetRoute)
    .route("/api/settings/data/restore", settingsDataRestoreRoute);
}

/** Hono RPC（`hc<AppType>`）用。静的配信・onError は含まない API 面のみ。 */
export type AppType = ReturnType<typeof createApiApp>;

export function createApp(options?: { clientDir?: string }) {
  const app = createApiApp();
  // docs/2nd_architecture/plan.md フェーズ2.7: 各ルートのtry/catchから漏れた例外の
  // 最終防波堤。プロセスを落とさず500 JSONで返す。
  app.onError(honoErrorHandler);
  if (options?.clientDir) {
    mountStaticClient(app, options.clientDir);
  }
  return app;
}

export const app = createApp();
