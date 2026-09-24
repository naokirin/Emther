// App のルートツリー定義。createRouter ごとに新しいインスタンスを作る（共有禁止）。
// validateSearch で既知キーを正規化し、未知キー（peek / focus 等）は落とさない。
import { createRootRoute, createRoute, redirect } from "@tanstack/react-router";
import type { ReactElement } from "react";
import { RootLayout } from "../routes/RootLayout";
import { DashboardPage } from "../routes/dashboard/DashboardPage";
import { HelpPage } from "../routes/help/HelpPage";
import { IssuesRedirect } from "../routes/issues/IssuesRedirect";
import { IssueDetailRedirect } from "../routes/issues/IssueDetailRedirect";
import { GoByIdPrefixPage } from "../routes/go/GoByIdPrefixPage";
import { EveningReviewPage } from "../routes/evening-review/EveningReviewPage";
import { MaskCheckPage } from "../routes/mask-check/MaskCheckPage";
import { TeamsPage } from "../routes/teams/TeamsPage";
import { SettingsPage } from "../routes/settings/SettingsPage";
import { PeoplePage } from "../routes/people/PeoplePage";
import { PersonDetailPage } from "../routes/people/PersonDetailPage";
import { OrgPage } from "../routes/org/OrgPage";
import { ReportsPage } from "../routes/reports/ReportsPage";
import { GrowthPage } from "../routes/growth/GrowthPage";
import { CheckinPage } from "../routes/checkin/CheckinPage";
import { JournalPage } from "../routes/journal/JournalPage";
import { SuggestionsPage } from "../routes/suggestions/SuggestionsPage";
import { SuggestionDetailPage } from "../routes/suggestions/SuggestionDetailPage";
import { AgentsPage } from "../routes/agents/AgentsPage";
import { ChatPage } from "../routes/chat/ChatPage";
import { agentsListSearchSchema } from "../components/agentsListSearch";
import { journalRouteSearchSchema } from "../components/journalListSearch";
import { suggestionsRouteSearchSchema } from "../components/suggestionListSearch";
import {
  chatSearchSchema,
  growthSearchSchema,
  peopleSearchSchema,
  teamsSearchSchema,
} from "./pageSearchSchemas";
import { validateSearchWith } from "./validateSearch";

export function createAppRouteTree() {
  // ルートツリーは createRouter ごとに新規構築する（インスタンス共有不可）。
  const rootRoute = createRootRoute({
    component: RootLayout,
  });

  function page(path: string, component: () => ReactElement | null) {
    return createRoute({
      getParentRoute: () => rootRoute,
      path,
      component,
    });
  }

  return rootRoute.addChildren([
    page("/", DashboardPage),
    page("/help", HelpPage),
    page("/evening-review", EveningReviewPage),
    page("/mask-check", MaskCheckPage),
    createRoute({
      getParentRoute: () => rootRoute,
      path: "/teams",
      component: TeamsPage,
      validateSearch: validateSearchWith(teamsSearchSchema),
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: "/timeline",
      beforeLoad: () => {
        throw redirect({ to: "/reports" });
      },
      component: () => null,
    }),
    page("/settings", SettingsPage),
    createRoute({
      getParentRoute: () => rootRoute,
      path: "/people",
      component: PeoplePage,
      validateSearch: validateSearchWith(peopleSearchSchema),
    }),
    page("/people/$id", PersonDetailPage),
    page("/org", OrgPage),
    page("/reports", ReportsPage),
    page("/checkin", CheckinPage),
    createRoute({
      getParentRoute: () => rootRoute,
      path: "/growth",
      component: GrowthPage,
      validateSearch: validateSearchWith(growthSearchSchema),
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: "/journal",
      component: JournalPage,
      validateSearch: validateSearchWith(journalRouteSearchSchema),
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: "/suggestions",
      component: SuggestionsPage,
      validateSearch: validateSearchWith(suggestionsRouteSearchSchema),
    }),
    page("/suggestions/$id", SuggestionDetailPage),
    createRoute({
      getParentRoute: () => rootRoute,
      path: "/agents",
      component: AgentsPage,
      validateSearch: validateSearchWith(agentsListSearchSchema),
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: "/chat",
      component: ChatPage,
      validateSearch: validateSearchWith(chatSearchSchema),
    }),
    page("/issues", IssuesRedirect),
    page("/issues/$id", IssueDetailRedirect),
    page("/go/$prefix", GoByIdPrefixPage),
  ]);
}
