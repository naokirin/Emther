import Link from "next/link";
import { redirect } from "next/navigation";
import styles from "@/app/page.module.css";
import { isHexIdPrefix } from "@/lib/id-prefix";
import { resolveIdPrefix, type IdMatchKind } from "@/lib/id-resolve";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<IdMatchKind, string> = {
  issue: "Issue",
  journal: "Journal",
  run: "相談 / Agent Run",
};

export default async function GoByIdPrefixPage({ params }: { params: Promise<{ prefix: string }> }) {
  const { prefix: raw } = await params;
  const prefix = decodeURIComponent(raw).trim();

  if (!isHexIdPrefix(prefix)) {
    return (
      <div className={styles.screen}>
        <Link href="/" className={styles.backLink}>
          ← ダッシュボードに戻る
        </Link>
        <h1>IDを解決できません</h1>
        <p className={styles.subtitle}>
          「{prefix}」は ID の先頭（8桁以上の十六進）として扱えません。エージェント出力などに含まれる短い ID をそのまま貼り付けてください。
        </p>
      </div>
    );
  }

  const matches = resolveIdPrefix(prefix);

  if (matches.length === 1) {
    redirect(matches[0].href);
  }

  if (matches.length === 0) {
    return (
      <div className={styles.screen}>
        <Link href="/" className={styles.backLink}>
          ← ダッシュボードに戻る
        </Link>
        <h1>一致する項目がありません</h1>
        <p className={styles.subtitle}>
          プレフィックス <code>{prefix}</code> に一致する Issue / Journal / 相談はありませんでした。
        </p>
      </div>
    );
  }

  return (
    <div className={styles.screen}>
      <Link href="/" className={styles.backLink}>
        ← ダッシュボードに戻る
      </Link>
      <h1>候補が複数あります</h1>
      <p className={styles.subtitle} style={{ marginBottom: 16 }}>
        プレフィックス <code>{prefix}</code> に一致する項目が {matches.length} 件あります。開きたいものを選んでください。
      </p>
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {matches.map((m) => (
          <li
            key={`${m.kind}:${m.id}`}
            style={{
              marginBottom: 10,
              padding: "10px 12px",
              border: "1px solid var(--border)",
              borderRadius: 8,
            }}
          >
            <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: 4 }}>
              {KIND_LABEL[m.kind]} · <code>{m.id.slice(0, 8)}</code>
            </div>
            <Link href={m.href} className={styles.tableRowLink} style={{ display: "inline", width: "auto" }}>
              {m.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
