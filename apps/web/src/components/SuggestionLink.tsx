import { Link } from "react-router";
import type { CSSProperties, MouseEvent, ReactNode } from "react";
import { useSuggestionPeek } from "./IdFragmentLink";

// web/src/components/SuggestionLink.tsx（Next.js版）からの移植（フェーズ3.5 tier2）。
// docs/memo.md「各画面で提案のリンクを踏んだときのデフォルト挙動をサイドピークにする」対応。
// 見た目・アクセシビリティは通常の<Link>のまま（href属性を持つので右クリック/新規タブ/
// クローラ等は従来どおり動く）が、修飾キー無しの通常クリックだけサイドピークで開く
// （IdFragmentLinkの遷移判定と同じ考え方）。
export function SuggestionLink({
  id,
  className,
  style,
  children,
}: {
  id: string;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const peek = useSuggestionPeek();

  function handleClick(e: MouseEvent<HTMLAnchorElement>) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    peek.open(id);
  }

  return (
    <Link to={`/suggestions/${id}`} className={className} style={style} onClick={handleClick}>
      {children}
    </Link>
  );
}
