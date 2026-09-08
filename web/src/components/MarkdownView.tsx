"use client";

import ReactMarkdown, { type Components } from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import styles from "@/app/page.module.css";

// docs/em_ui_ux_issue.md 7節「閲覧ビューと編集ビューの分離」対応。Issue charter（Why/What/How）・
// Journal本文など、EMが自由記述したテキストを見出し・箇条書き・太字を活かして読みやすく
// 描画する共有コンポーネント。remark-breaksで単一の改行も<br>として扱う（元がtextarea入力で、
// 段落間の空行を意識せず書かれている前提のため、素のCommonMarkの「空行が無いと改行が
// 無視される」挙動だとtextarea編集時と見た目が変わってしまう）。
const COMPONENTS: Components = {
  a: ({ children, ...props }) => (
    <a {...props} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  ),
};

export function MarkdownView({ text }: { text: string }) {
  return (
    <div className={styles.markdownView}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={COMPONENTS}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
