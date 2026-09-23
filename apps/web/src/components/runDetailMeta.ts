import styles from "../styles/page.module.css";
import type { AgentStatus } from "@emther/core/agent-runtime";

// フルバレル `@emther/core/agent-runtime`（旧）ではなく run-meta を直接参照する。
// バレル経由だと store/context-blocks → embeddings → node:fs がブラウザに載る。
export {
  draftKindLabel,
  isDraftAwaitingTriage,
  runFallbackTitle,
  runKindLabel,
  shouldOmitRunFromNextActions,
} from "@emther/core/agent-runtime/run-meta";

// CSS modules 依存のため web に残す。
export const STATUS_META: Record<AgentStatus, { icon: string; label: string; cls: string }> = {
  active: { icon: "🟢", label: "Active", cls: styles.active },
  queued: { icon: "⏳", label: "Queued（順番待ち）", cls: styles.queued },
  yield: { icon: "🟡", label: "Yield / Waiting", cls: styles.yield },
  idle: { icon: "⚪️", label: "Idle（完了・待機中）", cls: styles.idle },
  error: { icon: "🔴", label: "Error", cls: styles.error },
};
