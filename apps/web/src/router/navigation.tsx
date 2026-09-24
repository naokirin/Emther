// アプリ向けナビゲーション API。文字列 href の Link / navigate / MemoryRouter /
// useSearchParams を提供し、内部は TanStack Router に委譲する。
import {
  useCallback,
  useEffect,
  useMemo,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from "react";
import {
  Link as TanStackLink,
  Outlet,
  RouterContextProvider,
  RouterProvider,
  ScrollRestoration,
  createMemoryHistory,
  createRoute,
  createRootRoute,
  createRouter,
  redirect,
  useNavigate as useTanStackNavigate,
  useRouterState,
  type AnyRouter,
} from "@tanstack/react-router";
import { parsePlainSearch, stringifyPlainSearch } from "./plainSearch";

export { Outlet, RouterProvider, ScrollRestoration, redirect };

function parseAppHref(to: string): { pathname: string; search: Record<string, string>; hash: string } {
  const hashIndex = to.indexOf("#");
  const hash = hashIndex >= 0 ? to.slice(hashIndex + 1) : "";
  const withoutHash = hashIndex >= 0 ? to.slice(0, hashIndex) : to;
  const qIndex = withoutHash.indexOf("?");
  const pathname = qIndex >= 0 ? withoutHash.slice(0, qIndex) : withoutHash;
  const search =
    qIndex >= 0 ? Object.fromEntries(new URLSearchParams(withoutHash.slice(qIndex + 1))) : {};
  return { pathname: pathname || "/", search, hash };
}

type NavigateFn = {
  (to: string, options?: { replace?: boolean; preventScrollReset?: boolean }): void;
  (delta: number): void;
};

export function useNavigate(): NavigateFn {
  const navigate = useTanStackNavigate();
  return useCallback(
    ((to: string | number, options?: { replace?: boolean; preventScrollReset?: boolean }) => {
      if (typeof to === "number") {
        window.history.go(to);
        return;
      }
      const { pathname, search, hash } = parseAppHref(to);
      void (navigate as (opts: Record<string, unknown>) => void)({
        to: pathname,
        search,
        hash: hash || undefined,
        replace: options?.replace,
        resetScroll: options?.preventScrollReset ? false : undefined,
      });
    }) as NavigateFn,
    [navigate],
  );
}

export function useParams<T extends Record<string, string | undefined> = Record<string, string | undefined>>(): T {
  const matchParams = useRouterState({
    select: (s) => s.matches.at(-1)?.params ?? {},
  });
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  if (matchParams && Object.keys(matchParams as object).length > 0) {
    return matchParams as unknown as T;
  }

  // MemoryRouter + load 前は matches が空のため、アプリの動的セグメントを pathname から補完する
  const patterns: Array<{ re: RegExp; keys: string[] }> = [
    { re: /^\/people\/([^/]+)/, keys: ["id"] },
    { re: /^\/suggestions\/([^/]+)/, keys: ["id"] },
    { re: /^\/issues\/([^/]+)/, keys: ["id"] },
    { re: /^\/go\/([^/]+)/, keys: ["prefix"] },
  ];
  for (const { re, keys } of patterns) {
    const m = pathname.match(re);
    if (!m) continue;
    const out: Record<string, string> = {};
    keys.forEach((k, i) => {
      out[k] = m[i + 1]!;
    });
    return out as T;
  }

  return matchParams as unknown as T;
}

export function useLocation() {
  return useRouterState({
    select: (s) => {
      const searchStr = s.location.searchStr;
      return {
        pathname: s.location.pathname,
        search: searchStr.startsWith("?") || searchStr === "" ? searchStr || "" : `?${searchStr}`,
        hash: s.location.hash ? `#${s.location.hash.replace(/^#/, "")}` : "",
        state: s.location.state,
        key: String(s.location.state ?? s.location.pathname),
      };
    },
  });
}

type SetURLSearchParams = (
  nextInit: URLSearchParams | Record<string, string> | ((prev: URLSearchParams) => URLSearchParams),
  navigateOpts?: { replace?: boolean; preventScrollReset?: boolean },
) => void;

export function useSearchParams(): [URLSearchParams, SetURLSearchParams] {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const searchStr = useRouterState({ select: (s) => s.location.searchStr });
  const navigate = useTanStackNavigate();

  const searchParams = useMemo(() => {
    const raw = searchStr.startsWith("?") ? searchStr.slice(1) : searchStr;
    return new URLSearchParams(raw);
  }, [searchStr]);

  const setSearchParams = useCallback<SetURLSearchParams>(
    (nextInit, navigateOpts) => {
      const prev = new URLSearchParams(searchParams);
      const next =
        typeof nextInit === "function"
          ? nextInit(prev)
          : nextInit instanceof URLSearchParams
            ? nextInit
            : new URLSearchParams(nextInit);
      const search = Object.fromEntries(next.entries());
      void (navigate as (opts: Record<string, unknown>) => void)({
        to: pathname,
        search,
        replace: navigateOpts?.replace,
        resetScroll: navigateOpts?.preventScrollReset ? false : undefined,
      });
    },
    [navigate, pathname, searchParams],
  );

  return [searchParams, setSearchParams];
}

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

export { parsePlainSearch, stringifyPlainSearch } from "./plainSearch";

/** @deprecated テストは MemoryRouter + 実ページ直描画へ寄せる */
export function Routes({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

/** @deprecated テストは MemoryRouter + 実ページ直描画へ寄せる */
export function Route(_props: { path: string; element: ReactNode }) {
  return null;
}
