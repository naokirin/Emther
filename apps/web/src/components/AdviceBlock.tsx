import { useState } from "react";
import { IdLinkedText } from "./IdLinkedText";
import { AdviceReader } from "./AdviceReader";
import {
  adviceGroupOutlineLabel,
  adviceStructuredHasDetails,
  mergeAdviceFollowUps,
  shouldShowStructuredAdvice,
  type AdviceFollowUp,
  type AdviceStructured,
} from "@emther/core/advice";

export type AdviceDisplayFields = {
  advice?: string;
  adviceStructured?: AdviceStructured;
  adviceOverride?: string;
};

type Props = {
  fields: AdviceDisplayFields;
  /**
   * summary: 提案詳細向け。グループ見出しの目次＋全文はリーダー画面。
   * full: 判断・提案パネル向け。コンパクトなインライン表示。
   */
  presentation?: "summary" | "full";
  onFollowUp?: (followUp: AdviceFollowUp) => void;
  followUpsDisabled?: boolean;
  overrideNote?: string | null;
};

function AdviceGroupView({
  group,
  showTitle,
  index,
}: {
  group: AdviceStructured["groups"][number];
  showTitle: boolean;
  index: number;
}) {
  return (
    <div style={{ marginTop: showTitle || group.summary ? 10 : 0 }}>
      {showTitle && (
        <strong style={{ display: "block", fontSize: "0.85rem", marginBottom: 4 }}>
          {adviceGroupOutlineLabel(group, index)}
        </strong>
      )}
      {group.summary && (
        <p style={{ margin: "0 0 6px", fontSize: "0.85rem", lineHeight: 1.5 }}>
          <IdLinkedText text={group.summary} />
        </p>
      )}
      {group.nextActions && group.nextActions.length > 0 && (
        <div style={{ marginBottom: 6 }}>
          <strong style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>やること</strong>
          <ul style={{ margin: "4px 0 0 18px", fontSize: "0.85rem", padding: 0 }}>
            {group.nextActions.map((a, i) => (
              <li key={i}>
                <IdLinkedText text={a} />
              </li>
            ))}
          </ul>
        </div>
      )}
      {group.watchOuts && group.watchOuts.length > 0 && (
        <div style={{ marginBottom: 6 }}>
          <strong style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>注意点</strong>
          <ul style={{ margin: "4px 0 0 18px", fontSize: "0.85rem", padding: 0 }}>
            {group.watchOuts.map((a, i) => (
              <li key={i}>
                <IdLinkedText text={a} />
              </li>
            ))}
          </ul>
        </div>
      )}
      {group.verify && group.verify.length > 0 && (
        <div style={{ marginBottom: 6 }}>
          <strong style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>確認・検証</strong>
          <ul style={{ margin: "4px 0 0 18px", fontSize: "0.85rem", padding: 0 }}>
            {group.verify.map((a, i) => (
              <li key={i}>
                <IdLinkedText text={a} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function FollowUpChips({
  followUps,
  onFollowUp,
  disabled,
}: {
  followUps: AdviceFollowUp[];
  onFollowUp: (f: AdviceFollowUp) => void;
  disabled?: boolean;
}) {
  if (followUps.length === 0) return null;
  return (
    <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 6 }}>
      <span style={{ width: "100%", fontSize: "0.75rem", color: "var(--text-muted)" }}>深掘りする</span>
      {followUps.map((f) => (
        <button
          key={f.label}
          type="button"
          disabled={disabled}
          onClick={() => onFollowUp(f)}
          style={{
            fontSize: "0.75rem",
            padding: "4px 10px",
            borderRadius: 999,
            border: "1px solid var(--border)",
            background: "var(--bg-subtle, var(--surface))",
            color: "var(--fg)",
            cursor: disabled ? "not-allowed" : "pointer",
            opacity: disabled ? 0.5 : 1,
            textAlign: "left",
            maxWidth: "100%",
          }}
        >
          {f.label}
        </button>
      ))}
    </div>
  );
}

/** 進め方のアドバイス表示（構造化 or プレーン）＋追質問チップ。 */
export function AdviceBlock({
  fields,
  presentation = "full",
  onFollowUp,
  followUpsDisabled,
  overrideNote,
}: Props) {
  const [readerOpen, setReaderOpen] = useState(false);
  const showStructured = shouldShowStructuredAdvice(fields);
  const plain =
    fields.adviceOverride?.trim() ||
    (!showStructured ? fields.advice?.trim() : "") ||
    "";
  const structured = fields.adviceStructured;
  const hasContent = Boolean(plain || (structured && (structured.overview || structured.groups.length > 0)));
  if (!hasContent) return null;

  const followUps = onFollowUp ? mergeAdviceFollowUps(structured?.followUps) : [];
  const hasDetails = showStructured && structured ? adviceStructuredHasDetails(structured) : false;
  const summaryMode = presentation === "summary" && showStructured && structured;
  const outlineGroups = summaryMode && hasDetails ? structured.groups : [];

  return (
    <div
      style={{
        marginTop: 10,
        paddingTop: 10,
        borderTop: "1px dashed var(--border)",
        fontSize: "0.85rem",
        color: "var(--fg)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <strong style={{ color: "var(--accent)" }}>💡 進め方のアドバイス</strong>
        {(summaryMode ? hasDetails || Boolean(structured.overview) : false) && (
          <button
            type="button"
            onClick={() => setReaderOpen(true)}
            style={{
              fontSize: "0.78rem",
              padding: "3px 10px",
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: "var(--surface)",
              color: "var(--accent)",
              cursor: "pointer",
              fontWeight: 500,
              flexShrink: 0,
            }}
          >
            全文を開く
          </button>
        )}
      </div>
      {overrideNote && (
        <p style={{ margin: "6px 0 0", fontSize: "0.75rem", color: "var(--text-muted)" }}>{overrideNote}</p>
      )}

      {summaryMode ? (
        <div style={{ marginTop: 8 }}>
          {outlineGroups.length > 0 ? (
            <ul style={{ margin: "0 0 0 1.1rem", padding: 0, lineHeight: 1.55, listStyleType: "disc" }}>
              {outlineGroups.map((g, i) => (
                <li key={i} style={{ marginBottom: 4 }}>
                  <button
                    type="button"
                    onClick={() => setReaderOpen(true)}
                    style={{
                      background: "none",
                      border: "none",
                      padding: 0,
                      color: "var(--foreground)",
                      cursor: "pointer",
                      textAlign: "left",
                      fontSize: "0.85rem",
                      fontWeight: 500,
                      textDecoration: "underline",
                      textDecorationColor: "var(--border)",
                      textUnderlineOffset: 3,
                    }}
                  >
                    {adviceGroupOutlineLabel(g, i)}
                  </button>
                </li>
              ))}
            </ul>
          ) : structured.overview ? (
            <p style={{ margin: 0, lineHeight: 1.55 }}>
              <IdLinkedText text={structured.overview} />
            </p>
          ) : null}
        </div>
      ) : showStructured && structured ? (
        <div style={{ marginTop: 8 }}>
          {structured.overview && (
            <p style={{ margin: "0 0 8px", lineHeight: 1.5 }}>
              <IdLinkedText text={structured.overview} />
            </p>
          )}
          {structured.groups.map((g, i) => (
            <AdviceGroupView key={i} group={g} showTitle={structured.groups.length > 1} index={i} />
          ))}
        </div>
      ) : (
        <p style={{ margin: "8px 0 0", lineHeight: 1.55, whiteSpace: "pre-wrap" }}>
          <IdLinkedText text={plain} />
        </p>
      )}

      {onFollowUp && (
        <FollowUpChips followUps={followUps} onFollowUp={onFollowUp} disabled={followUpsDisabled} />
      )}

      {readerOpen && structured && (
        <AdviceReader
          structured={structured}
          onClose={() => setReaderOpen(false)}
          onFollowUp={
            onFollowUp
              ? (f) => {
                  setReaderOpen(false);
                  onFollowUp(f);
                }
              : undefined
          }
          followUpsDisabled={followUpsDisabled}
        />
      )}
    </div>
  );
}
