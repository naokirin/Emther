import { useMemo } from "react";
import {
  HIGHLIGHT_LABEL,
  HIGHLIGHT_STYLE,
  renderHighlightedText,
  textBlockStyle,
  type TextHighlight,
  type TextHighlightKind,
} from "./mask-check-display";

type Props = {
  sourceText: string | null;
  highlights: TextHighlight[];
};

export function HighlightedTextSection({ sourceText, highlights }: Props) {
  const legendKinds = useMemo(() => {
    const set = new Set<TextHighlightKind>();
    for (const h of highlights) set.add(h.kind);
    return [...set];
  }, [highlights]);

  return (
    <section>
      <h3 style={{ margin: "0 0 8px", fontSize: "1rem" }}>検出ハイライト（原文）</h3>
      <p style={{ fontSize: "0.75rem", color: "var(--muted)", margin: "0 0 8px" }}>
        色付き箇所が「特に問題になりそう」と判定された部分です（推測・誤検知あり）。
      </p>
      {legendKinds.length > 0 && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            marginBottom: 8,
            fontSize: "0.75rem",
          }}
        >
          {legendKinds.map((kind) => (
            <span
              key={kind}
              style={{
                ...HIGHLIGHT_STYLE[kind],
                padding: "2px 8px",
                borderRadius: 4,
              }}
            >
              {HIGHLIGHT_LABEL[kind]}
            </span>
          ))}
        </div>
      )}
      <div style={textBlockStyle} role="region" aria-label="検出ハイライト付き原文">
        {sourceText && highlights.length > 0
          ? renderHighlightedText(sourceText, highlights)
          : sourceText || "（なし）"}
      </div>
    </section>
  );
}
