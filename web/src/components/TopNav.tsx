"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "@/app/page.module.css";

// docs/em_human_story_and_ux.md P1-6「画面／ナビで今どの物語にいるかを一文で示す。
// タブ群のグルーピングも検討」対応。約10画面をEMの役割の4層＋振り返り（憲法／感知／相談／
// 介入／振り返り）でグルーピングする。グローバルメニューはグループ単位だけを
// 見せ、複数画面を持つグループは横タブでその中の画面を選ばせる2階層構成にする。
// 新しいURLは増やさず、既存の10画面をグルーピングし直すだけ。
//
// ユーザー指摘「課題タブの下に『人』があるのがわかりにくい」対応。Peopleは元々「介入」の
// 一部として課題グループの配下に置いていたが、Issue（起票済みの課題）とMember（人物）は
// EMにとって別の関心事のため、独立したグループ（メンバー）に分離した。
//
// 改修依頼「グローバルナビのラベルを『画面で何をするか』が分かる語に揃える」対応。
// 上記の物語語（起点／感知／介入／憲法）はメタファーが強く画面の中身が伝わりにくいため、
// タブの主ラベル（label）は実務語（今日／現場メモ／課題／方針・目標）に変え、物語語は
// hint（📍バナー・サブタブのツールチップ）側にのみ短く残す。相談／振り返り／設定は
// 元から実務語だったため据え置き。
type NavItem = { href: string; label: string };
type StoryGroup = {
  key: string;
  label: string;
  hint: string;
  items: NavItem[];
};

// ユーザー要望「タブの順番を『今日』『課題』『チーム・メンバー』『相談』『現場メモ』
// 『振り返り』『方針・目標』『設定』の順にしたい」対応。グルーピングの中身は変えず、
// 並び順だけをこの配列の並びで決める。
const STORY_GROUPS: StoryGroup[] = [
  { key: "dashboard", label: "今日", hint: "組織の状態を掴み、今日向き合う判断を選ぶ", items: [{ href: "/", label: "今日" }] },
  {
    key: "intervention",
    label: "課題",
    hint: "組織課題を計画・実行し、介入として人・仕組みの変化を見る",
    items: [{ href: "/issues", label: "課題一覧" }],
  },
  {
    // ユーザー指摘「課題タブの下に『人』があるのがわかりにくい」対応。課題（Issue）とは
    // 別の関心事として独立したグローバルタブに分離する。URLは/peopleのまま変更しない。
    //
    // ユーザー要望「メンバータブを『チーム・メンバー』とし、左メニューでチーム・メンバーを
    // 切り替えられるようにしたい」対応。複数画面グループにすると、AppShellが自動的に
    // サブナビを出す。後から左メニューは全グループ共通で横タブに揃えた。
    // 既定の遷移先（タブ本体クリック時）は従来通りの/people（日々の確認頻度が高い方）。
    key: "members",
    label: "チーム・メンバー",
    hint: "メンバーごとの気にかけるべき度合い・Journal・関連Issueの確認、チーム（体制）の追加・編集",
    items: [
      { href: "/people", label: "メンバー" },
      { href: "/teams", label: "チーム" },
    ],
  },
  {
    key: "consult",
    label: "相談",
    hint: "モヤモヤを壁打ちし、Issue化／様子見／却下を決める",
    items: [
      { href: "/chat", label: "何でも相談" },
      { href: "/agents", label: "エージェント" },
    ],
  },
  {
    key: "sensing",
    label: "現場メモ",
    hint: "現場の出来事を事実として残す・校正する",
    items: [{ href: "/journal", label: "現場メモ" }],
  },
  {
    key: "reflection",
    label: "振り返り",
    hint: "組織と自分の変化を読む（週次でよい・毎日必須ではない）",
    // 既定の遷移先はEMの成長（書く）。タイムライン／レポートは読む用として横タブで選ぶ。
    items: [
      { href: "/growth", label: "EMの成長" },
      { href: "/timeline", label: "タイムライン" },
      { href: "/reports", label: "レポート" },
    ],
  },
  {
    key: "constitution",
    label: "方針・目標",
    // ユーザー要望「方針・目標タブは方針・目標の設定によりフォーカスした形にしたい」対応。
    // チーム（体制）はメンバータブへ移設したため、ここはMVV・OKRの前提設定に絞る。
    hint: "組織の憲法＝MVV・目標（OKR）という前提を置く",
    items: [{ href: "/org", label: "方針・目標" }],
  },
  { key: "settings", label: "設定", hint: "しきい値・自動起動の挙動を調整する", items: [{ href: "/settings", label: "設定" }] },
];

function isItemActive(href: string, pathname: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

function findActiveGroup(pathname: string): StoryGroup | undefined {
  return STORY_GROUPS.find((g) => g.items.some((i) => isItemActive(i.href, pathname)));
}

// グローバルメニュー: グループ単位（8個）だけを並べる。クリックはそのグループの
// 最初の画面へ遷移する（複数画面を持つグループの中身は横タブ側で選ぶ）。
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
// 1文で示す。横タブが出ているグループ（複数画面）ではサブナビが同じ役割を果たすため、
// 単一画面のグループでだけ表示する（同じ文言の重複を避ける）。
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
// 対応。複数画面を持つグループで、グループ内の画面を選ぶサブナビを出す。
// 本文幅を確保するため、全グループ共通で横タブにする（設定画面内のカテゴリ切替だけ
// 従来のサイドメニューを残す）。単一画面のグループでは何も表示しない。
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const group = findActiveGroup(pathname);
  const showSubNav = !!group && group.items.length > 1;

  if (!showSubNav || !group) {
    return <>{children}</>;
  }

  return (
    <div>
      <nav className={styles.subTabs} aria-label={group.label} title={group.hint}>
        {group.items.map((item) => {
          const isActive = isItemActive(item.href, pathname);
          return (
            <Link key={item.href} href={item.href} className={`${styles.subTabBtn} ${isActive ? styles.subTabBtnActive : ""}`}>
              {item.label}
            </Link>
          );
        })}
      </nav>
      {children}
    </div>
  );
}
