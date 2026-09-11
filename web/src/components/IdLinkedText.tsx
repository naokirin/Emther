"use client";

import { IdFragmentLink } from "@/components/IdFragmentLink";
import { splitTextByIdFragments } from "@/lib/id-prefix";
import styles from "@/app/page.module.css";

/** プレーンテキスト中の UUID / 先頭8桁を解決可能なリンクにする。 */
export function IdLinkedText({ text }: { text: string }) {
  const segments = splitTextByIdFragments(text);
  return (
    <>
      {segments.map((seg, i) =>
        seg.type === "id" ? (
          <IdFragmentLink key={i} fragment={seg.value} className={styles.idFragmentLink}>
            {seg.value}
          </IdFragmentLink>
        ) : (
          <span key={i}>{seg.value}</span>
        ),
      )}
    </>
  );
}
