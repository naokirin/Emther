// アプリ向けナビゲーション components。文字列 href の Link / MemoryRouter を提供し、
// 内部は TanStack Router に委譲する。
import { useEffect, useMemo, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import {
  Link as TanStackLink,
  RouterContextProvider,
  createMemoryHistory,
  createRoute,
  createRootRoute,
  createRouter,
  type AnyRouter,
} from "@tanstack/react-router";
import { parseAppHref } from "./navigationHref";
import { useLocation, useNavigate } from "./navigationHooks";
import { parsePlainSearch, stringifyPlainSearch } from "./plainSearch";

type AppLinkProps = {
  to: string;
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  onClick?: (e: MouseEvent<HTMLAnchorElement>) => void;
  replace?: boolean;
  "aria-label"?: string;
  "data-tooltip"?: string;
  title?: string;
  target?: string;
  rel?: string;
};

export function Link({ to, replace, ...rest }: AppLinkProps) {
  const { pathname, search, hash } = parseAppHref(to);
  const Comp = TanStackLink as unknown as (props: Record<string, unknown>) => ReactNode;
  return (
    <Comp
      to={pathname}
      search={Object.keys(search).length > 0 ? search : undefined}
      hash={hash || undefined}
      replace={replace}
      {...rest}
    />
  );
}

export function Navigate({ to, replace = false }: { to: string; replace?: boolean }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { pathname, search, hash } = parseAppHref(to);
  const searchStr =
    Object.keys(search).length > 0 ? `?${new URLSearchParams(search).toString()}` : "";
  const hashStr = hash ? `#${hash}` : "";
  const target = `${pathname}${searchStr}${hashStr}`;
  const current = `${location.pathname}${location.search}${location.hash}`;

  useEffect(() => {
    if (current === target) return;
    navigate(to, { replace });
  }, [current, target, to, replace, navigate]);

  return null;
}

function createMemoryRouteTree() {
  const rootRoute = createRootRoute({
    validateSearch: (search: Record<string, unknown>) => search,
    component: () => null,
  });

  const paths = [
    "/",
    "/help",
    "/evening-review",
    "/mask-check",
    "/teams",
    "/timeline",
    "/settings",
    "/people",
    "/people/$id",
    "/org",
    "/reports",
    "/checkin",
    "/growth",
    "/journal",
    "/suggestions",
    "/suggestions/$id",
    "/agents",
    "/chat",
    "/issues",
    "/issues/$id",
    "/go/$prefix",
  ] as const;

  const children = paths.map((path) =>
    createRoute({
      getParentRoute: () => rootRoute,
      path,
      component: () => null,
    }),
  );

  return rootRoute.addChildren(children);
}

export function MemoryRouter({
  initialEntries = ["/"],
  children,
}: {
  initialEntries?: string[];
  children: ReactNode;
}) {
  const router = useMemo(() => {
    const history = createMemoryHistory({ initialEntries });
    const r = createRouter({
      routeTree: createMemoryRouteTree(),
      history,
      defaultPreload: false,
      parseSearch: parsePlainSearch,
      stringifySearch: stringifyPlainSearch,
      defaultPendingMs: 0,
      defaultPendingMinMs: 0,
    });
    void r.load();
    return r;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- マウント時の initialEntries のみ
  }, []);

  // RouterProvider はマッチ解決まで children を描画しないことがある。
  // テストではコンテキストだけ即時に渡し、画面は直下に描画する。
  return <RouterContextProvider router={router as AnyRouter}>{children}</RouterContextProvider>;
}

/** @deprecated テストは MemoryRouter + 実ページ直描画へ寄せる */
export function Routes({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

/** @deprecated テストは MemoryRouter + 実ページ直描画へ寄せる */
export function Route(_props: { path: string; element: ReactNode }) {
  void _props;
  return null;
}
