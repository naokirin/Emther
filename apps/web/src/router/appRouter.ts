import { createMemoryHistory, createRouter, type AnyRouter } from "@tanstack/react-router";
import { createAppRouteTree } from "./routeTree";
import { parsePlainSearch, stringifyPlainSearch } from "./plainSearch";

export function createAppRouter(opts?: { history?: ReturnType<typeof createMemoryHistory> }) {
  return createRouter({
    // ルートツリーは Router ごとに新規生成（共有不可）
    routeTree: createAppRouteTree(),
    history: opts?.history,
    defaultPreload: false,
    parseSearch: parsePlainSearch,
    stringifySearch: stringifyPlainSearch,
  });
}

export function createMemoryRouter(
  _routes: unknown,
  opts?: { initialEntries?: string[] },
): AnyRouter {
  const history = createMemoryHistory({ initialEntries: opts?.initialEntries ?? ["/"] });
  return createAppRouter({ history }) as AnyRouter;
}
