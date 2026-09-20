import { CATEGORY_LABEL, HIGHLIGHT_STYLE, renderExcerptWithMatch, SOURCE_LABEL, type NameMaskReplacement, type SensitiveFinding } from "./mask-check-display";

type Props = {
  replacements: NameMaskReplacement[];
  unregistered: string[];
  findings: SensitiveFinding[];
  busyAi: boolean;
};

export function NameAndFindingsSections({ replacements, unregistered, findings, busyAi }: Props) {
  return (
    <>
      <section>
        <h3 style={{ margin: "0 0 8px", fontSize: "1rem" }}>人名の置換一覧</h3>
        {replacements.length === 0 ? (
          <p style={{ fontSize: "0.875rem", color: "var(--muted)", margin: 0 }}>
            登録済み人名の置換はありません（People に未登録の名前はマスクされません）。
          </p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: "0.875rem" }}>
            {replacements.map((r) => (
              <li key={`${r.from}->${r.to}`}>
                <code>{r.from}</code> → <code>{r.to}</code>
                {r.count > 1 ? `（${r.count}箇所）` : ""}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 style={{ margin: "0 0 8px", fontSize: "1rem" }}>未登録の人名っぽい語句</h3>
        {unregistered.length === 0 && busyAi ? (
          <p style={{ fontSize: "0.875rem", color: "var(--muted)", margin: 0 }}>追加確認中…</p>
        ) : unregistered.length === 0 ? (
          <p style={{ fontSize: "0.875rem", color: "var(--muted)", margin: 0 }}>
            人名っぽい候補は見つかりませんでした。
          </p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: "0.875rem" }}>
            {unregistered.map((n) => (
              <li key={n}>
                <mark
                  style={{
                    ...HIGHLIGHT_STYLE.name_candidate,
                    padding: "0 4px",
                    borderRadius: 2,
                  }}
                >
                  {n}
                </mark>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 style={{ margin: "0 0 8px", fontSize: "1rem" }}>個人情報・機密情報っぽい箇所</h3>
        {findings.length === 0 && !busyAi ? (
          <p style={{ fontSize: "0.875rem", color: "var(--muted)", margin: 0 }}>
            候補は見つかりませんでした。保証ではありません。
          </p>
        ) : findings.length === 0 && busyAi ? (
          <p style={{ fontSize: "0.875rem", color: "var(--muted)", margin: 0 }}>
            ルールでは未検出。ローカルAIの結果を待っています…
          </p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: "0.875rem", display: "grid", gap: 8 }}>
            {findings.map((f, i) => (
              <li key={`${f.category}-${f.match}-${f.start ?? i}-${f.source}`}>
                <strong>{CATEGORY_LABEL[f.category]}</strong>
                <span style={{ color: "var(--muted)", marginLeft: 6 }}>
                  （{SOURCE_LABEL[f.source]}）
                </span>
                <div style={{ marginTop: 2 }}>
                  {renderExcerptWithMatch(f.excerpt, f.match || f.excerpt, f.category)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
