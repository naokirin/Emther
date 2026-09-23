import type { ReactNode } from "react";
import { Link, useLocation } from "react-router";
import styles from "../styles/page.module.css";
import { useEmCheckins } from "../lib/queries";

// web/src/components/TopNav.tsx（Next.js版）からの移植（フェーズ3.5）。
// docs/design/retrospective/retrospective-tab.pen: 「1日を締めくくる」を振り返りサブナビ末尾に追加。
// 未記録時のみ軽い強調（今日タブの帯は複製しない）。
type NavItem = { href: string; label: string };
type StoryGroup = {
  key: string;
  label: string;
  hint: string;
  items: NavItem[];
};

const EVENING_REVIEW_HREF = "/evening-review";

const STORY_GROUPS: StoryGroup[] = [
  { key: "dashboard", label: "今日", hint: "組織の状態を掴み、今日向き合う判断を選ぶ", items: [{ href: "/", label: "今日" }] },
  {
    key: "sensing",
    label: "ジャーナル",
    hint: "現場の出来事を事実として残す・校正する",
    items: [{ href: "/journal", label: "ジャーナル" }],
  },
  {
    key: "intervention",
    label: "提案",
    hint: "AIの提案を確認し、メモと壁打ちで理解を深める",
    items: [{ href: "/suggestions", label: "提案一覧" }],
  },
  {
    key: "consult",
    label: "相談",
    hint: "モヤモヤを壁打ちし、提案として残す／様子見／却下を決める。投入前の個人・機密情報チェックも含む",
    items: [
      { href: "/chat", label: "何でも相談" },
      { href: "/mask-check", label: "個人・機密情報チェック" },
      { href: "/agents", label: "エージェント" },
    ],
  },
  {
    key: "reflection",
    label: "振り返り・レポート",
    hint: "日次のコンディションと週次の学び・組織の全景（毎日必須ではない）",
    items: [
      { href: "/checkin", label: "自己チェックイン" },
      { href: "/growth", label: "EM週次振り返り" },
      { href: "/reports", label: "レポート" },
      { href: EVENING_REVIEW_HREF, label: "1日を締めくくる" },
    ],
  },
  {
    key: "members",
    label: "チーム・メンバー",
    hint: "メンバーごとの気にかけるべき度合い・Journal・関連提案の確認、チーム（体制）の追加・編集",
    items: [
      { href: "/people", label: "メンバー" },
      { href: "/teams", label: "チーム" },
    ],
  },
  {
    key: "constitution",
    label: "方針・目標",
    hint: "組織の憲法＝MVV・Goal・Policyという前提を置く",
    items: [{ href: "/org", label: "方針・目標" }],
  },
  { key: "settings", label: "設定", hint: "しきい値・自動起動の挙動を調整する", items: [{ href: "/settings", label: "設定" }] },
];

function isItemActive(href: string, pathname: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

function bestMatchingHref(items: NavItem[], pathname: string): string | undefined {
  const matches = items.filter((i) => isItemActive(i.href, pathname));
  if (matches.length === 0) return undefined;
  return matches.reduce((best, cur) => (cur.href.length > best.href.length ? cur : best)).href;
}

function findActiveGroup(pathname: string): StoryGroup | undefined {
  return STORY_GROUPS.find((g) => g.items.some((i) => isItemActive(i.href, pathname)));
}

function hasCheckinToday(checkins: { createdAt: number }[]): boolean {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const start = todayStart.getTime();
  return checkins.some((c) => c.createdAt >= start);
}

export function TopNav() {
  const pathname = useLocation().pathname;
  const activeGroup = findActiveGroup(pathname);

  return (
    <nav className={styles.tabs}>
      {STORY_GROUPS.map((group) => (
        <Link
          key={group.key}
          to={group.items[0].href}
          className={`${styles.tabBtn} ${activeGroup?.key === group.key ? styles.tabBtnActive : ""} ${styles.axisTooltip} ${styles.axisTooltipDownCenter}`}
          data-tooltip={group.hint}
        >
          {group.label}
        </Link>
      ))}
    </nav>
  );
}

function SubNavLinks({
  group,
  pathname,
  eveningNeedsAttention,
}: {
  group: StoryGroup;
  pathname: string;
  eveningNeedsAttention: boolean;
}) {
  const activeHref = bestMatchingHref(group.items, pathname);

  return (
    <nav className={styles.subTabs} aria-label={group.label}>
      {group.items.map((item) => {
        const isActive = item.href === activeHref;
        const attention = eveningNeedsAttention && item.href === EVENING_REVIEW_HREF;
        return (
          <Link
            key={item.href}
            to={item.href}
            className={`${styles.subTabBtn} ${isActive ? styles.subTabBtnActive : ""} ${attention ? styles.subTabBtnAttention : ""}`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** 振り返りグループだけチェックイン未記録を見て「1日を締めくくる」を軽く強調する。 */
function ReflectionSubNav({ group, pathname }: { group: StoryGroup; pathname: string }) {
  const { checkins, checkinsLoaded } = useEmCheckins();
  const eveningNeedsAttention = checkinsLoaded && !hasCheckinToday(checkins);
  return <SubNavLinks group={group} pathname={pathname} eveningNeedsAttention={eveningNeedsAttention} />;
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = useLocation().pathname;
  const group = findActiveGroup(pathname);
  const showSubNav = !!group && group.items.length > 1;

  if (!showSubNav || !group) {
    return <>{children}</>;
  }

  return (
    <div>
      {group.key === "reflection" ? (
        <ReflectionSubNav group={group} pathname={pathname} />
      ) : (
        <SubNavLinks group={group} pathname={pathname} eveningNeedsAttention={false} />
      )}
      {children}
    </div>
  );
}
