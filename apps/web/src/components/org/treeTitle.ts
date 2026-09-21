// 左ツリー・一覧カードで長文タイトルの先頭行だけを見せるための共有ヘルパー。
export function treeTitle(title: string): string {
  const first = title.split("\n")[0]?.trim() || title;
  return title.includes("\n") ? `${first}…` : first;
}
