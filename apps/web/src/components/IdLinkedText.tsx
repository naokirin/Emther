import { IdFragmentLink } from "./IdFragmentLink";
import { splitTextByIdFragments } from "@emther/core/id-prefix";
import styles from "../styles/page.module.css";

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
