"use client";

import ReactMarkdown, { type Components } from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import styles from "@/app/page.module.css";
import { IdFragmentLink } from "@/components/IdFragmentLink";
import { linkifyIdFragmentsInMarkdown } from "@/lib/id-prefix";

// docs/em_ui_ux_issue.md 7節「閲覧ビューと編集ビューの分離」対応。Issue charter（Why/What/How）・
// Journal本文など、EMが自由記述したテキストを見出し・箇条書き・太字を活かして読みやすく
// 描画する共有コンポーネント。remark-breaksで単一の改行も<br>として扱う（元がtextarea入力で、
// 段落間の空行を意識せず書かれている前提のため、素のCommonMarkの「空行が無いと改行が
// 無視される」挙動だとtextarea編集時と見た目が変わってしまう）。
//
// エージェント出力に含まれる Issue/Journal/Run の短い ID（先頭8桁など）は /go/<id> へ
// リンク化し、クリック時はクライアントで解決する（サイドピーク内では Issue をピークで開き直す）。

function GoLink({ href, children }: { href?: string; children: React.ReactNode }) {
  const prefix = typeof href === "string" && href.startsWith("/go/") ? decodeURIComponent(href.slice("/go/".length)) : "";
  if (!prefix) {
    return (
      <a href={href} target="_blank" rel="noreferrer noopener">
        {children}
      </a>
    );
  }
  return (
    <IdFragmentLink fragment={prefix} className={styles.idFragmentLink}>
      {children}
    </IdFragmentLink>
  );
}

const COMPONENTS: Components = {
  a: ({ children, href, ...props }) => {
    if (typeof href === "string" && href.startsWith("/go/")) {
      return <GoLink href={href}>{children}</GoLink>;
    }
    const internal = typeof href === "string" && href.startsWith("/") && !href.startsWith("//");
    if (internal) {
      return (
        <a {...props} href={href}>
          {children}
        </a>
      );
    }
    return (
      <a {...props} href={href} target="_blank" rel="noreferrer noopener">
        {children}
      </a>
    );
  },
};

export function MarkdownView({ text }: { text: string }) {
  const linked = linkifyIdFragmentsInMarkdown(text);
  return (
    <div className={styles.markdownView}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={COMPONENTS}>
        {linked}
      </ReactMarkdown>
    </div>
  );
}
