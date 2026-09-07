"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "@/app/page.module.css";

// docs/em_human_story_and_ux.md P1-6「画面／ナビで今どの物語にいるかを一文で示す。
// タブ群のグルーピングも検討」対応。約10画面をEMの役割の4層＋振り返り（憲法／感知／相談／
// 介入／振り返り）でグルーピングする。グローバルメニューはグループ単位（7個）だけを
// 見せ、複数画面を持つグループだけサイドメニューでその中の画面を選ばせる2階層構成にする。
// 新しいURLは増やさず、既存の10画面をグルーピングし直すだけ。
type NavItem = { href: string; label: string };
type StoryGroup = {
  key: string;
  label: string;
  hint: string;
  items: NavItem[];
};

const STORY_GROUPS: StoryGroup[] = [
  { key: "dashboard", label: "起点", hint: "組織の状態を掴み、今日の判断を選ぶ", items: [{ href: "/", label: "Dashboard" }] },
  { key: "sensing", label: "感知", hint: "現場の出来事を事実として残す", items: [{ href: "/journal", label: "Journal" }] },
  { key: "consult", label: "相談", hint: "モヤモヤを壁打ちし、追跡するか決める", items: [{ href: "/chat", label: "何でも相談" }] },
  {
    key: "intervention",
    label: "介入",
    hint: "人・仕組み・優先順位を動かし、結果を見る",
    items: [
      { href: "/issues", label: "Issue Workspace" },
      { href: "/people", label: "People" },
    ],
  },
  {
    key: "constitution",
    label: "憲法",
    hint: "MVV・体制・目標という前提を決める",
    items: [{ href: "/org", label: "Organization Context" }],
  },
  {
    key: "reflection",
    label: "振り返り（週次でよい）",
    hint: "組織と自分の変化を読む",
    items: [
      { href: "/timeline", label: "Timeline" },
      { href: "/reports", label: "Reports" },
      { href: "/growth", label: "EMの成長" },
    ],
  },
  { key: "settings", label: "設定", hint: "しきい値・自動起動の挙動を調整する", items: [{ href: "/settings", label: "Settings" }] },
];

function isItemActive(href: string, pathname: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

function findActiveGroup(pathname: string): StoryGroup | undefined {
  return STORY_GROUPS.find((g) => g.items.some((i) => isItemActive(i.href, pathname)));
}

// グローバルメニュー: グループ単位（7個）だけを並べる。クリックはそのグループの
// 最初の画面へ遷移する（複数画面を持つグループの中身はサイドメニュー側で選ぶ）。
export function TopNav() {
  const pathname = usePathname();
  const activeGroup = findActiveGroup(pathname);

  return (
    <nav className={styles.tabs}>
      {STORY_GROUPS.map((group) => (
        <Link
          key={group.key}
          href={group.items[0].href}
          className={`${styles.tabBtn} ${activeGroup?.key === group.key ? styles.tabBtnActive : ""}`}
          title={group.hint}
        >
          {group.label}
        </Link>
      ))}
    </nav>
  );
}

// docs/em_human_story_and_ux.md P1-6対応。現在地のURLから「今どの物語にいるか」を
// 1文で示す。サイドメニューが出ているグループ（複数画面）ではサイドメニューの見出しが
// 同じ役割を果たすため、単一画面のグループでだけ表示する（同じ文言の重複を避ける）。
export function StoryBanner() {
  const pathname = usePathname();
  const group = findActiveGroup(pathname);
  if (!group || group.items.length > 1) return null;
  return (
    <p className={styles.subtitle} style={{ margin: "-12px 0 16px" }}>
      📍 {group.label}: {group.hint}
    </p>
  );
}

// docs/em_human_story_and_ux.md 改修依頼「グローバルメニュー＋サイドメニューのグルーピング」
// 対応。複数画面を持つグループ（介入／振り返り）でだけ、そのグループ内の画面を選ぶ
// サイドメニューを出す。単一画面のグループでは何も表示しない（無駄な空カラムを作らない）。
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const group = findActiveGroup(pathname);
  const showSideNav = !!group && group.items.length > 1;

  if (!showSideNav) {
    return <>{children}</>;
  }

  return (
    <div className={styles.appBody}>
      <nav className={styles.sideNav}>
        <div className={styles.sideNavHint} title={group.hint}>
          📍 {group.label}
        </div>
        {group.items.map((item) => {
          const isActive = isItemActive(item.href, pathname);
          return (
            <Link key={item.href} href={item.href} className={`${styles.sideNavItem} ${isActive ? styles.sideNavItemActive : ""}`}>
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className={styles.appContent}>{children}</div>
    </div>
  );
}
