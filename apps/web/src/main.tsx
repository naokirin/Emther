import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";

// フェーズ3.1時点では骨組みのみ。画面移植（3.4/3.5）でルートを追加していく。
const router = createBrowserRouter([
  {
    path: "/",
    element: <App />,
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
