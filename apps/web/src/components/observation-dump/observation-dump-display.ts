export const SOURCE_OPTIONS = [
  { value: "chat_log", label: "チャットログ（Slack等）" },
  { value: "meeting_log", label: "MTGログ（議事・文字起こし）" },
  { value: "other_log", label: "その他ログ" },
];

export const STATUS_LABEL: Record<string, string> = {
  received: "受信済み",
  parsing: "分割中…",
  draft_ready: "提案あり",
  partially_accepted: "一部採用",
  done: "完了",
  discarded: "破棄",
  failed: "失敗",
};

export function formatWhen(ts: number): string {
  try {
    return new Date(ts).toLocaleString("ja-JP", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

/** useNameCandidateConfirm().fetchWithNameConfirm の型（複数コンポーネントでpropsとして受け渡すため）。 */
export type FetchWithNameConfirm = (
  url: string,
  init: { method?: string; body: Record<string, unknown> },
  actionLabel: string,
) => Promise<{ res: Response; data: unknown }>;
