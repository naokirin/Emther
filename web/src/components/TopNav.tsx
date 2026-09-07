"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "@/app/page.module.css";

// docs/em_human_story_and_ux.md P1-6「画面／ナビで今どの物語にいるかを一文で示す。
// タブ群のグルーピングも検討」対応。約10画面に増えたタブを、EMの役割の4層＋振り返り
// （憲法／感知／相談／介入／振り返り）でグルーピングし、区切り線で視覚的にまとめる。
// 新しいURLや画面は増やさず、既存タブへのラベル付けだけで対応する。
type StoryGroup = {
  key: string;
  label: string;
  hint: string;
};

const STORY_GROUPS: Record<string, StoryGroup> = {
  dashboard: { key: "dashboard", label: "起点", hint: "組織の状態を掴み、今日の判断を選ぶ" },
  sensing: { key: "sensing", label: "感知", hint: "現場の出来事を事実として残す" },
  consult: { key: "consult", label: "相談", hint: "モヤモヤを壁打ちし、追跡するか決める" },
  intervention: { key: "intervention", label: "介入", hint: "人・仕組み・優先順位を動かし、結果を見る" },
  constitution: { key: "constitution", label: "憲法", hint: "MVV・体制・目標という前提を決める" },
  reflection: { key: "reflection", label: "振り返り（週次でよい）", hint: "組織と自分の変化を読む" },
  settings: { key: "settings", label: "設定", hint: "しきい値・自動起動の挙動を調整する" },
};

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", group: "dashboard" },
  { href: "/journal", label: "Journal", group: "sensing" },
  { href: "/chat", label: "何でも相談", group: "consult" },
  { href: "/issues", label: "Issue Workspace", group: "intervention" },
  { href: "/people", label: "People", group: "intervention" },
  { href: "/org", label: "Organization Context", group: "constitution" },
  { href: "/timeline", label: "Timeline", group: "reflection" },
  { href: "/reports", label: "Reports", group: "reflection" },
  { href: "/growth", label: "EMの成長", group: "reflection" },
  { href: "/settings", label: "Settings", group: "settings" },
] as const;

// Issue一覧・Issue詳細・Dashboard・Organization Contextは実URLを持つ別画面にしているため、
// タブ状態ではなくNext.jsの<Link>でナビゲーションする。/issues/[id]でも
// 「Issue Workspace」がアクティブに見えるよう前方一致で判定する。
export function TopNav() {
  const pathname = usePathname();

  return (
    <nav className={styles.tabs}>
      {NAV_ITEMS.map((item, i) => {
        const isActive = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        const isNewGroup = i > 0 && NAV_ITEMS[i - 1].group !== item.group;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`${styles.tabBtn} ${isActive ? styles.tabBtnActive : ""}`}
            style={isNewGroup ? { marginLeft: 10, borderLeft: "1px solid var(--border)", paddingLeft: 14 } : undefined}
            title={STORY_GROUPS[item.group].hint}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

// docs/em_human_story_and_ux.md P1-6対応。現在地のURLから「今どの物語にいるか」を
// 1文で示す薄い帯。layout.tsx側でナビのすぐ下・各画面共通で表示する。
export function StoryBanner() {
  const pathname = usePathname();
  const item = [...NAV_ITEMS].reverse().find((i) => (i.href === "/" ? pathname === "/" : pathname.startsWith(i.href)));
  const group = item ? STORY_GROUPS[item.group] : undefined;
  if (!group) return null;
  return (
    <p className={styles.subtitle} style={{ margin: "-12px 0 16px" }}>
      📍 {group.label}: {group.hint}
    </p>
  );
}
