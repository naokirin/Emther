import { useEffect, useState } from "react";
import { Link, Navigate, useParams } from "react-router";
import styles from "../../styles/page.module.css";
import { isHexIdPrefix } from "@emther/core/id-prefix";
import type { IdMatch, IdMatchKind } from "@emther/core/id-resolve";

// web/src/app/go/[prefix]/page.tsx（Next.js版、async Server ComponentがDBへ直接
// resolveIdPrefix()を呼ぶ実装）からの移植（フェーズ3.5 tier1）。apps/webは純粋な
// クライアントSPAのためDB直読みはできず、フェーズ2.3で移植済みの
// `GET /api/id-resolve?q=`（同じresolveIdPrefix()を内部で呼ぶ）経由に置き換えた。
const KIND_LABEL: Record<IdMatchKind, string> = {
  issue: "Issue",
  journal: "Journal",
  run: "相談 / Agent Run",
};

type ResolveState = { status: "loading" } | { status: "invalid" } | { status: "resolved"; matches: IdMatch[] };

export function GoByIdPrefixPage() {
  const { prefix: raw } = useParams();
  const prefix = decodeURIComponent(raw ?? "").trim();
  const [state, setState] = useState<ResolveState>(isHexIdPrefix(prefix) ? { status: "loading" } : { status: "invalid" });

  useEffect(() => {
    if (!isHexIdPrefix(prefix)) {
      setState({ status: "invalid" });
      return;
    }
    let cancelled = false;
    setState({ status: "loading" });
    (async () => {
      const res = await fetch(`/api/id-resolve?q=${encodeURIComponent(prefix)}`);
      const data = (await res.json()) as { matches?: IdMatch[] };
      if (!cancelled) setState({ status: "resolved", matches: data.matches ?? [] });
    })();
    return () => {
      cancelled = true;
    };
  }, [prefix]);

  if (state.status === "invalid") {
    return (
      <div className={styles.screen}>
        <Link to="/" className={styles.backLink}>
          ← ダッシュボードに戻る
        </Link>
        <h1>IDを解決できません</h1>
        <p className={styles.subtitle}>
          「{prefix}」は ID の先頭（8桁以上の十六進）として扱えません。エージェント出力などに含まれる短い ID をそのまま貼り付けてください。
        </p>
      </div>
    );
  }

  // 解決中は何も描画しない（元のRSC版は解決完了後の結果のみ描画していたため、
  // ちらつきの無いその挙動に揃える）。
  if (state.status === "loading") {
    return null;
  }

  const { matches } = state;

  if (matches.length === 1) {
    return <Navigate to={matches[0].href} replace />;
  }

  if (matches.length === 0) {
    return (
      <div className={styles.screen}>
        <Link to="/" className={styles.backLink}>
          ← ダッシュボードに戻る
        </Link>
        <h1>一致する項目がありません</h1>
        <p className={styles.subtitle}>
          プレフィックス <code>{prefix}</code> に一致する 提案 / Journal / 相談はありませんでした。
        </p>
      </div>
    );
  }

  return (
    <div className={styles.screen}>
      <Link to="/" className={styles.backLink}>
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
            <Link to={m.href} className={styles.tableRowLink} style={{ display: "inline", width: "auto" }}>
              {m.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
