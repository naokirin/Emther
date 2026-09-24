// TanStack 既定の JSON search ではなく、URLSearchParams 互換の plain string にする。
// （done=1 を done=%221%22 にしない／既存の deep link・Zod ラッパーと整合させる）
export function parsePlainSearch(searchStr: string): Record<string, string> {
  const raw = searchStr.startsWith("?") ? searchStr.slice(1) : searchStr;
  return Object.fromEntries(new URLSearchParams(raw));
}

export function stringifyPlainSearch(search: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}
