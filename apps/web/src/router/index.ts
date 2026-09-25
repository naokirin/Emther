// アプリ公開のルーター API（ナビゲーション + ページ横断 search スキーマ）。
// createAppRouter / routeTree は main から直接 import（循環参照防止）。
export {
  Outlet,
  RouterProvider,
  ScrollRestoration,
  redirect,
} from "@tanstack/react-router";

export { Link, MemoryRouter, Navigate, Route, Routes } from "./navigation";
export { useLocation, useNavigate, useParams, useSearchParams } from "./navigationHooks";

export { parsePlainSearch, stringifyPlainSearch } from "./plainSearch";
export { validateSearchWith } from "./validateSearch";
export {
  archivedFlagSearchSchema,
  chatSearchSchema,
  growthSearchSchema,
  peopleSearchSchema,
  teamsSearchSchema,
} from "./pageSearchSchemas";
