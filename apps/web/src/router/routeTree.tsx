import {
  createRootRoute,
  createRoute,
  redirect,
} from "@tanstack/react-router";
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

export function createAppRouteTree() {
  // search はルート横断で緩く通し、画面側の Zod（useTypedSearchParams）で解釈する。
  // ルートツリーは createRouter ごとに新規構築する（インスタンス共有不可）。
  const rootRoute = createRootRoute({
    validateSearch: (search: Record<string, unknown>) => search,
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
    page("/teams", TeamsPage),
    createRoute({
      getParentRoute: () => rootRoute,
      path: "/timeline",
      beforeLoad: () => {
        throw redirect({ to: "/reports" });
      },
      component: () => null,
    }),
    page("/settings", SettingsPage),
    page("/people", PeoplePage),
    page("/people/$id", PersonDetailPage),
    page("/org", OrgPage),
    page("/reports", ReportsPage),
    page("/checkin", CheckinPage),
    page("/growth", GrowthPage),
    page("/journal", JournalPage),
    page("/suggestions", SuggestionsPage),
    page("/suggestions/$id", SuggestionDetailPage),
    page("/agents", AgentsPage),
    page("/chat", ChatPage),
    page("/issues", IssuesRedirect),
    page("/issues/$id", IssueDetailRedirect),
    page("/go/$prefix", GoByIdPrefixPage),
  ]);
}
