"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "@/app/page.module.css";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard" },
  { href: "/chat", label: "何でも相談" },
  { href: "/issues", label: "Issue Workspace" },
  { href: "/org", label: "Organization Context" },
  { href: "/settings", label: "Settings" },
];

// Issue一覧・Issue詳細・Dashboard・Organization Contextは実URLを持つ別画面にしているため、
// タブ状態ではなくNext.jsの<Link>でナビゲーションする。/issues/[id]でも
// 「Issue Workspace」がアクティブに見えるよう前方一致で判定する。
export function TopNav() {
  const pathname = usePathname();

  return (
    <nav className={styles.tabs}>
      {NAV_ITEMS.map((item) => {
        const isActive = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        return (
          <Link key={item.href} href={item.href} className={`${styles.tabBtn} ${isActive ? styles.tabBtnActive : ""}`}>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
