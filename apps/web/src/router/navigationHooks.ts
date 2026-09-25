// アプリ向けナビゲーション hooks。内部は TanStack Router に委譲する。
import { useCallback, useMemo } from "react";
import {
  useNavigate as useTanStackNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { parseAppHref } from "./navigationHref";

type NavigateFn = {
  (to: string, options?: { replace?: boolean; preventScrollReset?: boolean }): void;
  (delta: number): void;
};

export function useNavigate(): NavigateFn {
  const navigate = useTanStackNavigate();
  return useCallback(
    (to: string | number, options?: { replace?: boolean; preventScrollReset?: boolean }) => {
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
    },
    [navigate],
  ) as NavigateFn;
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
