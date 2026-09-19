import { Hono } from "hono";
import { healthRoute } from "./routes/health";
import { glossaryRoute } from "./routes/glossary";
import { vitalsRoute } from "./routes/vitals";
import { timelineRoute } from "./routes/timeline";
import { idResolveRoute } from "./routes/id-resolve";
import { knowledgeEventsRoute } from "./routes/knowledge-events";
import { teamsRoute } from "./routes/teams";
import { orgBackgroundRoute } from "./routes/org-background";
import { reportsRoute } from "./routes/reports";
import { growthSuggestionsRoute } from "./routes/growth-suggestions";
import { checkinsRoute, reflectionNotesRoute } from "./routes/em-self";
import { peopleRoute } from "./routes/people";
import { orgObjectivesRoute } from "./routes/org-objectives";
import { orgStrategyRoute } from "./routes/org-strategy";
import { journalRoute } from "./routes/journal";
import { settingsRulesRoute } from "./routes/settings-rules";
import { themesRoute } from "./routes/themes";
import { agentsRoute, agentsInboxRoute, agentsPendingUnmaskedRoute } from "./routes/agents";
import { issuesRoute } from "./routes/issues";
import { suggestionsRoute } from "./routes/suggestions";
import { themesDistillRoute } from "./routes/themes-distill";
import { growthGenerateRoute } from "./routes/growth-generate";
import { modelsStatusRoute } from "./routes/models-status";
import { maskCheckRoute } from "./routes/mask-check";
import { journalLocalSummarizeRoute } from "./routes/journal-local-summarize";
import { knowledgeInterpretationsRoute } from "./routes/knowledge-interpretations";
import { settingsDataBackupRoute } from "./routes/settings-data-backup";
import { journalDumpsRoute } from "./routes/journal-dumps";
import { orgObjectivesParseRoute } from "./routes/org-objectives-parse";
import { issuesLinkSuggestRoute } from "./routes/issues-link-suggest";
import { themesLinkSuggestRoute } from "./routes/themes-link-suggest";

// docs/2nd_architecture/plan.md フェーズ2: apps/server 骨組み。
// ルート追加のたびに、対応する web/src/app/api/**/route.ts を
// web/src/lib/hono-proxy.ts 経由のフォワードへ置き換える（並走運用）。
export function createApp() {
  const app = new Hono();
  app.route("/api/health", healthRoute);
  app.route("/api/glossary", glossaryRoute);
  app.route("/api/vitals", vitalsRoute);
  app.route("/api/timeline", timelineRoute);
  app.route("/api/id-resolve", idResolveRoute);
  app.route("/api/knowledge/events", knowledgeEventsRoute);
  app.route("/api/teams", teamsRoute);
  app.route("/api/org/background", orgBackgroundRoute);
  app.route("/api/reports", reportsRoute);
  app.route("/api/growth/suggestions", growthSuggestionsRoute);
  app.route("/api/em-self/checkins", checkinsRoute);
  app.route("/api/em-self/reflection-notes", reflectionNotesRoute);
  app.route("/api/people", peopleRoute);
  app.route("/api/org/objectives/parse", orgObjectivesParseRoute);
  app.route("/api/org/objectives", orgObjectivesRoute);
  app.route("/api/org/strategy", orgStrategyRoute);
  // 注意: Honoは別々にmountされたサブアプリ同士でパスが重なる場合、静的パスを
  // 優先せず「先にmountされた方」が勝つ（単一Honoインスタンス内でのstatic-vs-:id
  // 優先とは挙動が異なる）。そのため、あるprefix配下のサブパスを別ファイルへ切り出す
  // ときは、親（:idワイルドカードを持つ）より必ず先にmountすること
  // （実例: /api/journal/dumps が /api/journal の GET /:id に飲まれていた不具合。
  // docs/2nd_architecture/plan.md フェーズ2.5 高リスク バッチ9参照）。
  app.route("/api/journal/local-summarize", journalLocalSummarizeRoute);
  app.route("/api/journal/dumps", journalDumpsRoute);
  app.route("/api/journal", journalRoute);
  app.route("/api/settings/rules", settingsRulesRoute);
  app.route("/api/themes/distill", themesDistillRoute);
  app.route("/api/themes/link/suggest", themesLinkSuggestRoute);
  app.route("/api/themes", themesRoute);
  app.route("/api/agents/inbox", agentsInboxRoute);
  app.route("/api/agents/pending-unmasked", agentsPendingUnmaskedRoute);
  app.route("/api/agents", agentsRoute);
  app.route("/api/issues/link/suggest", issuesLinkSuggestRoute);
  app.route("/api/issues", issuesRoute);
  app.route("/api/suggestions", suggestionsRoute);
  app.route("/api/growth/generate", growthGenerateRoute);
  app.route("/api/models/status", modelsStatusRoute);
  app.route("/api/mask-check", maskCheckRoute);
  app.route("/api/knowledge/interpretations", knowledgeInterpretationsRoute);
  app.route("/api/settings/data/backup", settingsDataBackupRoute);
  return app;
}

export const app = createApp();
