import styles from "@/app/page.module.css";
import { textBlockStyle } from "./mask-check-display";

type Props = {
  maskedText: string | null;
  copied: boolean;
  onCopy: () => void;
};

export function MaskedTextSection({ maskedText, copied, onCopy }: Props) {
  return (
    <section>
      <div className={styles.detailHeader} style={{ marginBottom: 8 }}>
        <h3 style={{ margin: 0, fontSize: "1rem" }}>人名マスク後のテキスト</h3>
        <button type="button" className={styles.btnOutline} onClick={onCopy}>
          {copied ? "コピーしました" : "コピー"}
        </button>
      </div>
      <pre style={textBlockStyle}>{maskedText}</pre>
    </section>
  );
}
