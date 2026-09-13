import type { MaskOptions } from "@/lib/name-candidate-confirmation";
import { getCurrentJournalEntry, type JournalEntry } from "@/lib/journal-store";
import { startJournalAnalysis, type AgentRun } from "@/lib/agent-runtime";

// Journal（journal-store）とAgent Run（agent-runtime）という2つのドメインを組み合わせて
// 「EMが明示した手動分析」を実行する薄いアプリケーションサービス。どちらのドメイン層にも
// 依存を持たせない（journal-store⇄agent-runtimeの循環参照を避ける）ため、両方に依存してよい
// この層に置く。

// docs/usage_issues U16。自動フィルタ外・自動OFF・修正なし確定後でも、EMが明示して分析を起動する。
// 未確認（AI抽出のまま）では起動しない——投稿時点起動と同じ誤検知リスクを避ける。
export async function requestJournalAnalysis(
  id: string,
  opts: MaskOptions = {},
): Promise<{ entry: JournalEntry; run: AgentRun } | undefined> {
  const entry = getCurrentJournalEntry(id);
  if (!entry) return undefined;
  if (!entry.confirmed) {
    throw new Error("未確認のJournalは分析できません。先に内容を確定してください。");
  }
  const run = await startJournalAnalysis(entry.rawText, entry.id, {
    ...opts,
    trigger: "manual",
    onUnconfirmedNames: "throw",
  });
  if (!run) {
    throw new Error("分析の起動に失敗しました");
  }
  return { entry, run };
}
