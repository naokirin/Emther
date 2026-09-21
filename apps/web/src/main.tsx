import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
// 配布ビルドが Google Fonts へのネットワーク取得に依存しないよう、npm 同梱の
// @fontsource を使う（web/src/app/layout.tsxからの移植、docs/packaging.md参照）。
import "@fontsource/zen-kaku-gothic-new/japanese-400.css";
import "@fontsource/zen-kaku-gothic-new/japanese-500.css";
import "@fontsource/zen-kaku-gothic-new/japanese-700.css";
import "@fontsource/zen-kaku-gothic-new/japanese-900.css";
import "@fontsource/zen-kaku-gothic-new/latin-400.css";
import "@fontsource/zen-kaku-gothic-new/latin-500.css";
import "@fontsource/zen-kaku-gothic-new/latin-700.css";
import "@fontsource/zen-kaku-gothic-new/latin-900.css";
import "@fontsource/jetbrains-mono/latin-400.css";
import "@fontsource/jetbrains-mono/latin-600.css";
import "./styles/globals.css";
import { RootLayout } from "./routes/RootLayout";
import { DashboardPage } from "./routes/dashboard/DashboardPage";
import { HelpPage } from "./routes/help/HelpPage";
import { IssuesRedirect } from "./routes/issues/IssuesRedirect";
import { IssueDetailRedirect } from "./routes/issues/IssueDetailRedirect";
import { GoByIdPrefixPage } from "./routes/go/GoByIdPrefixPage";
import { EveningReviewPage } from "./routes/evening-review/EveningReviewPage";
import { MaskCheckPage } from "./routes/mask-check/MaskCheckPage";
import { TeamsPage } from "./routes/teams/TeamsPage";
import { TimelinePage } from "./routes/timeline/TimelinePage";
import { SettingsPage } from "./routes/settings/SettingsPage";
import { PeoplePage } from "./routes/people/PeoplePage";
import { PersonDetailPage } from "./routes/people/PersonDetailPage";
import { OrgPage } from "./routes/org/OrgPage";
import { ReportsPage } from "./routes/reports/ReportsPage";
import { GrowthPage } from "./routes/growth/GrowthPage";
import { JournalPage } from "./routes/journal/JournalPage";
import { SuggestionsPage } from "./routes/suggestions/SuggestionsPage";
import { SuggestionDetailPage } from "./routes/suggestions/SuggestionDetailPage";
import { AgentsPage } from "./routes/agents/AgentsPage";
import { ChatPage } from "./routes/chat/ChatPage";

// フェーズ3.5（画面単位移植）: ルートシェル（旧web/src/app/layout.tsx相当）+ tier1〜tier5
// （docs/2nd_architecture/plan.md フェーズ3.4の5ティア移行順）を全て移植し、21画面の
// 移植が完了した。index（"/"）はダッシュボード本体（DashboardPage）に差し替え済み。
const router = createBrowserRouter([
  {
    path: "/",
    element: <RootLayout />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: "help", element: <HelpPage /> },
      { path: "evening-review", element: <EveningReviewPage /> },
      { path: "mask-check", element: <MaskCheckPage /> },
      { path: "teams", element: <TeamsPage /> },
      { path: "timeline", element: <TimelinePage /> },
      { path: "settings", element: <SettingsPage /> },
      { path: "people", element: <PeoplePage /> },
      { path: "people/:id", element: <PersonDetailPage /> },
      { path: "org", element: <OrgPage /> },
      { path: "reports", element: <ReportsPage /> },
      { path: "growth", element: <GrowthPage /> },
      { path: "journal", element: <JournalPage /> },
      { path: "suggestions", element: <SuggestionsPage /> },
      { path: "suggestions/:id", element: <SuggestionDetailPage /> },
      { path: "agents", element: <AgentsPage /> },
      { path: "chat", element: <ChatPage /> },
      { path: "issues", element: <IssuesRedirect /> },
      { path: "issues/:id", element: <IssueDetailRedirect /> },
      { path: "go/:prefix", element: <GoByIdPrefixPage /> },
    ],
  },
]);

// フェーズ3.2: hooks.tsのusePolling群を置き換えるサーバー状態層。
// queryClient自体はプロセス内でシングルトン（画面遷移をまたいでキャッシュを共有する）。
const queryClient = new QueryClient();

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("root element not found");
}

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
