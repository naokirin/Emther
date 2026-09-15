import type { ReactNode } from "react";
import Link from "next/link";
import styles from "@/app/page.module.css";

/** 画面内の仕組み説明をヘルプへ退避するための短いリンク。 */
export function HelpLink({
  anchor,
  label = "ヘルプ",
}: {
  anchor: string;
  label?: string;
}) {
  return (
    <Link
      href={`/help#${anchor}`}
      className={`${styles.helpLink} ${styles.axisTooltip} ${styles.axisTooltipDownCenter}`}
      data-tooltip="仕組み・用語の説明"
    >
      {label}
    </Link>
  );
}

/** 見出し行: タイトル + ヘルプ（+ 右側アクション）。 */
export function PageTitleRow({
  title,
  helpAnchor,
  children,
  as: Tag = "h2",
}: {
  title: string;
  helpAnchor: string;
  children?: ReactNode;
  as?: "h2" | "h3";
}) {
  return (
    <div className={styles.detailHeader} style={{ marginBottom: children ? 12 : 0 }}>
      <div className={styles.pageTitleWithHelp}>
        <Tag style={{ margin: 0 }}>{title}</Tag>
        <HelpLink anchor={helpAnchor} />
      </div>
      {children}
    </div>
  );
}
