/** アプリの文字列 href を TanStack Router 向けに分解する。 */
export function parseAppHref(to: string): {
  pathname: string;
  search: Record<string, string>;
  hash: string;
} {
  const hashIndex = to.indexOf("#");
  const hash = hashIndex >= 0 ? to.slice(hashIndex + 1) : "";
  const withoutHash = hashIndex >= 0 ? to.slice(0, hashIndex) : to;
  const qIndex = withoutHash.indexOf("?");
  const pathname = qIndex >= 0 ? withoutHash.slice(0, qIndex) : withoutHash;
  const search =
    qIndex >= 0 ? Object.fromEntries(new URLSearchParams(withoutHash.slice(qIndex + 1))) : {};
  return { pathname: pathname || "/", search, hash };
}
