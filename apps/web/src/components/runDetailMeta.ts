import styles from "../styles/page.module.css";
import type { AgentStatus } from "@emther/core/agent-runtime";

export {
  draftKindLabel,
  isDraftAwaitingTriage,
  runFallbackTitle,
  runKindLabel,
  shouldOmitRunFromNextActions,
} from "@emther/core/agent-runtime";

// CSS modules 依存のため web に残す。
export const STATUS_META: Record<AgentStatus, { icon: string; label: string; cls: string }> = {
  active: { icon: "🟢", label: "Active", cls: styles.active },
  queued: { icon: "⏳", label: "Queued（順番待ち）", cls: styles.queued },
  yield: { icon: "🟡", label: "Yield / Waiting", cls: styles.yield },
  idle: { icon: "⚪️", label: "Idle（完了・待機中）", cls: styles.idle },
  error: { icon: "🔴", label: "Error", cls: styles.error },
};
