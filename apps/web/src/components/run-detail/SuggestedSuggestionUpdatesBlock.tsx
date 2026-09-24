import { useState } from "react";
import styles from "../../styles/page.module.css";
import { IdLinkedText } from "../IdLinkedText";
import { IdFragmentLink } from "../IdFragmentLink";
import { CONFIRM_PRIORITY_META, SUGGESTION_REVIEW_STATUS_META, type Suggestion } from "@emther/core/types";
import type { SuggestionUpdate } from "@emther/core/agent-runtime";

type FieldDiff = { label: string; before: string; after: string };

function reviewStatusLabel(status: Suggestion["reviewStatus"]): string {
  const meta = SUGGESTION_REVIEW_STATUS_META[status];
  return `${meta.icon} ${meta.label}`;
}

function confirmPriorityLabel(priority: Suggestion["confirmPriority"]): string {
  const meta = CONFIRM_PRIORITY_META[priority];
  return `${meta.icon} ${meta.label}`;
}

function formatDueAt(ts: number): string {
  return new Date(ts).toLocaleDateString("ja-JP");
}

// 差分一覧
// （ID・変更前後・理由）をEMが一度見て「まとめて反映」できるようにする。currentは
// 取得できなかった場合（未読み込み・ID解決不能）は「不明」と表示するだけで、反映自体は
// APIサイドの再解決に委ねる（表示上の不一致で採用をブロックしない）
function fieldDiffsFor(update: SuggestionUpdate, current: Suggestion | undefined): FieldDiff[] {
  const diffs: FieldDiff[] = [];
  if (update.reviewStatus !== undefined) {
    diffs.push({
      label: "確認状態",
      before: current ? reviewStatusLabel(current.reviewStatus) : "不明",
      after: reviewStatusLabel(update.reviewStatus),
    });
  }
  if (update.confirmPriority !== undefined) {
    diffs.push({
      label: "確認優先度",
      before: current ? confirmPriorityLabel(current.confirmPriority) : "不明",
      after: confirmPriorityLabel(update.confirmPriority),
    });
  }
  if (update.reviewDueAt !== undefined) {
    diffs.push({
      label: "確認期日",
      before: current?.reviewDueAt ? formatDueAt(current.reviewDueAt) : "未設定",
      after: update.reviewDueAt === null ? "解除" : formatDueAt(update.reviewDueAt),
    });
  }
  if (update.archived !== undefined) {
    diffs.push({
      label: "アーカイブ",
      before: current?.archivedAt ? "アーカイブ済み" : "未アーカイブ",
      after: update.archived ? "アーカイブする" : "解除する",
    });
  }
  return diffs;
}

export function SuggestedSuggestionUpdatesBlock({
  updates,
  currentSuggestions,
  onAdopt,
  onDismiss,
  submitting,
}: {
  updates: SuggestionUpdate[];
  currentSuggestions: Map<string, Suggestion>;
  onAdopt?: (indices: number[]) => void;
  onDismiss?: (indices: number[]) => void;
  submitting?: boolean;
}) {
  const [selected, setSelected] = useState<Set<number>>(() => new Set(updates.map((_, i) => i)));

  function toggle(i: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  const selectedIndices = updates.map((_, i) => i).filter((i) => selected.has(i));
  const hasSelection = selectedIndices.length > 0;

  return (
    <div className={styles.yieldBlock} style={{ marginTop: 12 }}>
      <strong>🗂️ 既存提案の整理差分</strong>
      <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: 6 }}>
        依頼に基づき、既存の提案の確認状態・優先度などの変更をAgentがまとめました。「まとめて反映」を押すまで対象の提案には反映されません。
        {updates.length > 1 ? "チェックで対象を選べます（未選択のものは差分のまま残ります）。" : ""}
      </p>
      {updates.map((update, i) => {
        const current = currentSuggestions.get(update.suggestionId);
        const diffs = fieldDiffsFor(update, current);
        return (
          <label
            key={i}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 8,
              fontSize: "0.875rem",
              marginTop: 10,
              paddingTop: 8,
              borderTop: "1px solid var(--border)",
            }}
          >
            <input
              type="checkbox"
              checked={selected.has(i)}
              onChange={() => toggle(i)}
              style={{ marginTop: 3 }}
            />
            <span style={{ flex: 1 }}>
              <strong>
                提案:{" "}
                <IdFragmentLink fragment={update.suggestionId} className={styles.idFragmentLink}>
                  {current?.title ? current.title : update.suggestionId.slice(0, 8)}
                </IdFragmentLink>
              </strong>
              {diffs.length > 0 && (
                <ul style={{ listStyle: "none", margin: "4px 0", padding: 0 }}>
                  {diffs.map((d) => (
                    <li key={d.label} style={{ margin: "2px 0" }}>
                      {d.label}: {d.before} → {d.after}
                    </li>
                  ))}
                </ul>
              )}
              {update.note && (
                <p style={{ margin: "4px 0" }}>
                  メモ追記: <IdLinkedText text={update.note} />
                </p>
              )}
              <p style={{ margin: "4px 0", color: "var(--text-muted)" }}>
                理由: <IdLinkedText text={update.reason} />
              </p>
            </span>
          </label>
        );
      })}
      <div className={styles.yieldActions}>
        <button
          className={styles.primaryBtn}
          style={{ width: "auto" }}
          disabled={submitting || !hasSelection}
          onClick={() => onAdopt?.(selectedIndices)}
        >
          まとめて反映
        </button>
        <button className={styles.btnOutline} disabled={submitting || !hasSelection} onClick={() => onDismiss?.(selectedIndices)}>
          却下する
        </button>
      </div>
    </div>
  );
}
